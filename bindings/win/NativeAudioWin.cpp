#include <cstring>
#include <cstdlib>
#include <windows.h>
#include <dsound.h>
#include <stdio.h>
#include "NativeAudioWin.h"

/*
 SampleBuffer
 サンプルデータを格納しておく構造体
 
 */
typedef struct
{
#define SAMPLE_MAX 16000
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

static int shiftSamples(SampleBuffer *buf, short *output, int num) {
    int to_output=num;
    if(to_output>buf->used) to_output=buf->used;
    if(output) for(int i=0;i<to_output;i++) output[i]=buf->samples[i];
    int to_shift=buf->used-to_output;
    for(int i=to_output;i<buf->used;i++) buf->samples[i-to_output]=buf->samples[i];
    buf->used-=to_output;
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

// Direct Sound 特有の処理

#pragma comment(lib, "dsound.lib")
#pragma comment(lib, "dxguid.lib")

#define NUM_CHANNELS 1
#define BITS_PER_SAMPLE 16
#define BUFFER_SIZE(hz) (hz * NUM_CHANNELS * BITS_PER_SAMPLE / 8)

LPDIRECTSOUNDCAPTURE8 pDSCapture = NULL;
LPDIRECTSOUNDCAPTUREBUFFER pDSCaptureBuffer = NULL;
LPDIRECTSOUND8 pDS = NULL;
LPDIRECTSOUNDBUFFER pDSBuffer = NULL;




int startMic() {

    if (FAILED(DirectSoundCaptureCreate8(NULL, &pDSCapture, NULL))) {
        return -1;
    }

    WAVEFORMATEX wfx;
    wfx.wFormatTag = WAVE_FORMAT_PCM;
    wfx.nSamplesPerSec = g_recFreq;
    wfx.wBitsPerSample = BITS_PER_SAMPLE;
    wfx.nChannels = NUM_CHANNELS;
    wfx.nBlockAlign = (wfx.wBitsPerSample / 8) * wfx.nChannels;
    wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;
    wfx.cbSize = 0;

    DSCBUFFERDESC dscbd;
    ZeroMemory(&dscbd, sizeof(dscbd));
    dscbd.dwSize = sizeof(dscbd);
    dscbd.dwBufferBytes = BUFFER_SIZE(g_recFreq);
    dscbd.lpwfxFormat = &wfx;

    if (FAILED(pDSCapture->CreateCaptureBuffer(&dscbd, &pDSCaptureBuffer, NULL))) {
        return -2;
    }
    pDSCaptureBuffer->Start(DSCBSTART_LOOPING);

    return 0;
}

int listDevices() {
    return 0;
}
int startSpeaker() {
    HWND hwnd = GetConsoleWindow();

    if (FAILED(DirectSoundCreate8(NULL, &pDS, NULL))) {
        return -1;
    }

    if (FAILED(pDS->SetCooperativeLevel(hwnd, DSSCL_PRIORITY))) {
        return -2;
    }

    WAVEFORMATEX wfx;
    wfx.wFormatTag = WAVE_FORMAT_PCM;
    wfx.nSamplesPerSec = g_playFreq;
    wfx.wBitsPerSample = BITS_PER_SAMPLE;
    wfx.nChannels = NUM_CHANNELS;
    wfx.nBlockAlign = (wfx.wBitsPerSample / 8) * wfx.nChannels;
    wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;
    wfx.cbSize = 0;

    DSBUFFERDESC dsbd;
    ZeroMemory(&dsbd, sizeof(dsbd));
    dsbd.dwSize = sizeof(dsbd);
    dsbd.dwFlags = DSBCAPS_GLOBALFOCUS;
    dsbd.dwBufferBytes = BUFFER_SIZE(g_playFreq);
    dsbd.lpwfxFormat = &wfx;

    if (FAILED(pDS->CreateSoundBuffer(&dsbd, &pDSBuffer, NULL))) {
        return -3;
    }

    return 0;
}

void updateRecord() {
    if(!pDSCaptureBuffer) return;
    const DWORD bufferSize=BUFFER_SIZE(g_recFreq);
    DWORD capturePos, readPos;
    pDSCaptureBuffer->GetCurrentPosition(&capturePos, &readPos);                        
    DWORD lockSize=0;
    if(capturePos>readPos) lockSize=capturePos-readPos; 
    else if(capturePos<readPos) lockSize=(bufferSize-readPos)+capturePos;
    if(lockSize>0) {
        LPVOID readPtr1, readPtr2;
        DWORD readBytes1, readBytes2;
        pDSCaptureBuffer->Lock(readPos, lockSize, &readPtr1, &readBytes1, &readPtr2, &readBytes2, 0);
        pushSamples(g_recbuf,(short*)readPtr1,readBytes1/2);
        if (readPtr2) pushSamples(g_recbuf,(short*)readPtr2,readBytes2/2);
        pDSCaptureBuffer->Unlock(readPtr1, readBytes1, readPtr2, readBytes2);
    }     
}
/* 再生バッファを使い切ったときはtrue を返す*/
bool updatePlay() {
    if(!pDSBuffer) return true;
    const DWORD bufferSize=BUFFER_SIZE(g_playFreq);
    DWORD playPos, writePos;
    pDSBuffer->GetCurrentPosition(&playPos, &writePos);
    DWORD lockSize=0;
    if(playPos>writePos) lockSize=(bufferSize-playPos)+writePos; 
    else if(playPos<writePos) lockSize=writePos-playPos;
    bool exhausted=false;
    if(lockSize>0) {
        DWORD to_shift=lockSize/2;
        if(to_shift<=g_playbuf->used) {
            LPVOID writePtr1, writePtr2;
            DWORD writeBytes1, writeBytes2;
            fprintf(stderr,"lockSize=%d used=%d to_shift:%d playPos:%d writePos:%d\n",lockSize,g_playbuf->used,to_shift,playPos,writePos);
            pDSBuffer->Lock(writePos, lockSize, &writePtr1, &writeBytes1, &writePtr2, &writeBytes2, 0);
            shiftSamples(g_playbuf,(short*)writePtr1,writeBytes1/2);
            if(writePtr2) shiftSamples(g_playbuf,(short*)writePtr2,writeBytes2/2);
            pDSBuffer->Unlock(writePtr1, writeBytes1, writePtr2, writeBytes2);

        } else {
            exhausted=true;
        }
/*      
        else {
            fprintf(stderr,"zeroing\n");
            memset(writePtr1,0,writeBytes1);
            if (writePtr2) {
                memset(writePtr2,0,writeBytes2);
            }
        } */
    } else  {
        fprintf(stderr,"kkkk\n");
    }
    pDSBuffer->Play(0, 0, DSBPLAY_LOOPING);
    return exhausted;
}

void update() 
{
    updateRecord();
    updatePlay();
    
}
void stop() {
    pDSCaptureBuffer->Stop();
    pDSBuffer->Stop();
}