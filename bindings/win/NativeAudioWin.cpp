#include <cstring>
#include <cstdlib>
#include <windows.h>
#include <stdio.h>
#include "NativeAudioWin.h"

#include "portaudio.h"

/*
 SampleBuffer
 サンプルデータを格納しておく構造体
 
 */
typedef struct
{
#define SAMPLE_MAX 48000
    short samples[SAMPLE_MAX];
    int used;
} SampleBuffer;

SampleBuffer *g_recbuf; /* 録音したサンプルデータ */
SampleBuffer *g_playbuf; /* 再生予定のサンプルデータ */

int g_recFreq=32000;
int g_playFreq=32000;

/* 必要なSampleBufferを初期化する.  */
void initSampleBuffers(int recFreq,int playFreq) {
    g_recFreq=recFreq;
    g_playFreq=playFreq;

    g_recbuf = (SampleBuffer*) malloc(sizeof(SampleBuffer));
    memset(g_recbuf,0,sizeof(SampleBuffer));
    g_playbuf = (SampleBuffer*) malloc(sizeof(SampleBuffer));
    memset(g_playbuf,0,sizeof(SampleBuffer));
}
static int totShifted=0;
static int firstTick=0;
static int shiftSamples(SampleBuffer *buf, short *output, int num) {
    int to_output=num;
    if(to_output>buf->used) to_output=buf->used;
    if(output) for(int i=0;i<to_output;i++) output[i]=buf->samples[i];
    int to_shift=buf->used-to_output;
    for(int i=to_output;i<buf->used;i++) buf->samples[i-to_output]=buf->samples[i];
    buf->used-=to_output;
    totShifted+=to_output;
    int tick=GetTickCount();
    if(firstTick==0) firstTick=tick;
    int dt=tick-firstTick;
    float shiftPerSec=(float)totShifted/(float)dt*1000;
    return to_output;
}
static void pushSamples(SampleBuffer *buf,short *append, int num) {
    if(buf->used+num>SAMPLE_MAX) shiftSamples(buf,NULL,num);
    for(int i=0;i<num;i++) {
        buf->samples[i+buf->used]=append[i];
    }
    buf->used+=num;
}


/* マイクから受け取ったサンプルの保存されている数を返す */
int getRecordedSampleCount() {
    return g_recbuf->used;
}
/* マイクから受け取って保存されているサンプルを1個取得する */
short getRecordedSample(int index) {
    return g_recbuf->samples[index];
}
/* 再生するサンプルを1サンプルだけ送る. */
void pushSamplesForPlay(short *samples, int num) {
    pushSamples(g_playbuf,samples,num);
}

int getPlayBufferUsed() {
    return g_playbuf->used;
}
int getRecordedSamples(short *samples_out, int maxnum) {
    int to_copy=maxnum;
    if(to_copy>g_recbuf->used) to_copy=g_recbuf->used;
    for(int i=0;i<to_copy;i++) samples_out[i]=g_recbuf->samples[i];
    return to_copy;
}
void discardRecordedSamples(int num) {
    shiftSamples(g_recbuf,NULL,num);
}

///////////////////

// PortAudio 特有の処理


#define NUM_CHANNELS 1
#define BITS_PER_SAMPLE 16
#define BUFFER_SIZE(hz) (hz * NUM_CHANNELS * BITS_PER_SAMPLE / 8)

#define PA_SAMPLE_TYPE  paInt16
typedef short SAMPLE;
#define FRAMES_PER_BUFFER   (512)
typedef unsigned long PaStreamCallbackFlags;
static PaStream* g_inputStream;
static PaStream* g_outputStream;

static int recordCallback( const void *inputBuffer, void *outputBuffer,
                           unsigned long framesPerBuffer,
                           const PaStreamCallbackTimeInfo* timeInfo,
                           PaStreamCallbackFlags statusFlags,
                           void *userData )
{
    short recordbuf[FRAMES_PER_BUFFER];
    const SAMPLE *rptr = (const SAMPLE*)inputBuffer;
    long framesToCalc = framesPerBuffer;
    long i;

    if( inputBuffer == NULL )
    {
        for( i=0; i<framesToCalc; i++ )
        {
            recordbuf[i] = 0; 
        }
    }
    else
    {
        for( i=0; i<framesToCalc; i++ )
        {
            recordbuf[i] = *rptr++;
        }
    }
    pushSamples(g_recbuf,recordbuf,framesToCalc);
    return 0;
}

int startMic() {
    PaError             err = paNoError;

    err = Pa_Initialize();
    if (err != paNoError) {
        return -1;
    }
    PaStreamParameters  inputParameters;

    inputParameters.device = Pa_GetDefaultInputDevice(); /* default input device */
    if (inputParameters.device == paNoDevice) {
        fprintf(stderr,"Error: No default input device.\n");
        return -2;
    }
    
    inputParameters.channelCount = 1;                    /* stereo input */
    inputParameters.sampleFormat = PA_SAMPLE_TYPE;
    inputParameters.suggestedLatency = Pa_GetDeviceInfo( inputParameters.device )->defaultLowInputLatency;
    inputParameters.hostApiSpecificStreamInfo = NULL;
   
    err = Pa_OpenStream(
              &g_inputStream,
              &inputParameters,
              NULL,                  /* &outputParameters, */
              g_recFreq,
              FRAMES_PER_BUFFER,
              paClipOff,      /* we won't output out of range samples so don't bother clipping them */
              recordCallback,
              NULL);
    if( err != paNoError ) return -3;

    err = Pa_StartStream( g_inputStream );
    if( err != paNoError ) return -4;

    return 0;
}

int listDevices() {
    int numDevices;
    numDevices = Pa_GetDeviceCount();
    if( numDevices < 0 ) {
        fprintf(stderr, "ERROR: Pa_CountDevices returned 0x%x\n", numDevices);
        return -1;
    }
    fprintf(stderr, "Number of devices = %d\n", numDevices);
    for (int i = 0; i < numDevices; i++) {
        const PaDeviceInfo *deviceInfo;
        deviceInfo = Pa_GetDeviceInfo(i);
        //hexDump(deviceInfo->name,strlen(deviceInfo->name));

        fprintf(stderr, "Device %d: %s samplerate:%d\n", i, deviceInfo->name, deviceInfo->defaultSampleRate);

    }
    return 0;
}

static int playCallback( const void *inputBuffer, void *outputBuffer,
                         unsigned long framesPerBuffer,
                         const PaStreamCallbackTimeInfo* timeInfo,
                         PaStreamCallbackFlags statusFlags,
                         void *userData )
{
    SAMPLE *wptr = (SAMPLE*)outputBuffer;

    if( g_playbuf->used < (int)framesPerBuffer ) {
        fprintf(stderr,"playCallback: buffer exhausted\n");
        memset(wptr,0,framesPerBuffer*NUM_CHANNELS*sizeof(SAMPLE));
        return 0;
    }
    shiftSamples(g_playbuf,wptr,framesPerBuffer);
    return 0;
}


int startSpeaker() {
    PaError  err = Pa_Initialize();
    if (err != paNoError) {
        return -1;
    }
    PaStreamParameters outputParameters;
    outputParameters.device = Pa_GetDefaultOutputDevice(); /* default output device */
    if (outputParameters.device == paNoDevice) {
        fprintf(stderr,"Error: No default output device.\n");
        return -1;
    }
    outputParameters.channelCount = 1;                     /* stereo output */
    outputParameters.sampleFormat =  PA_SAMPLE_TYPE;
    outputParameters.suggestedLatency = Pa_GetDeviceInfo( outputParameters.device )->defaultLowOutputLatency;
    outputParameters.hostApiSpecificStreamInfo = NULL;

    err = Pa_OpenStream(
              &g_outputStream,
              NULL, /* no input */
              &outputParameters,
              g_playFreq,
              FRAMES_PER_BUFFER,
              paClipOff,      /* we won't output out of range samples so don't bother clipping them */
              playCallback,
              NULL );
    if( err != paNoError ) return -2;

    if( !g_outputStream ) return -3;

    err = Pa_StartStream( g_outputStream );
    if( err != paNoError ) return -4;

    return 0;
}

void stop() {
   
}