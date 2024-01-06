#include <cstring>
#include <cstdlib>
#include <windows.h>
#include <dsound.h>
#include <stdio.h>

#define EXPORT __declspec(dllexport)

extern "C" {
    EXPORT void initSampleBuffers();
    EXPORT int getRecordedSampleCount();
    EXPORT short getRecordedSample(int index);
    EXPORT void pushSamplesForPlay(short *samples, int num);
    EXPORT int startMic();
    EXPORT int listDevices();
    EXPORT int startSpeaker();
    EXPORT void update();
    EXPORT void stop();
};

/*
 SampleBuffer
 サンプルデータを格納しておく構造体
 
 */
typedef struct
{
#define SAMPLE_MAX 24000
    short samples[SAMPLE_MAX];
    int used;
} SampleBuffer;

SampleBuffer *g_recbuf; // 録音したサンプルデータ
SampleBuffer *g_playbuf; // 再生予定のサンプルデータ

// 必要なSampleBufferを初期化する
void initSampleBuffers() {
    g_recbuf = (SampleBuffer*) malloc(sizeof(SampleBuffer));
    memset(g_recbuf,0,sizeof(SampleBuffer));
    g_playbuf = (SampleBuffer*) malloc(sizeof(SampleBuffer));
    memset(g_playbuf,0,sizeof(SampleBuffer));
}

static int shiftSamples(SampleBuffer *buf, short *output, int num) {
    int to_output=num;
    if(to_output>buf->used) to_output=buf->used;
    // output
    if(output) for(int i=0;i<to_output;i++) output[i]=buf->samples[i];
    // shift
    int to_shift=buf->used-to_output;
    for(int i=to_output;i<buf->used;i++) buf->samples[i-to_output]=buf->samples[i];
    buf->used-=to_output;
    //fprintf(stderr,"shiftSamples: buf used: %d\n",buf->used);
    return to_output;
}
static void pushSamples(SampleBuffer *buf,short *append, int num) {
    if(buf->used+num>SAMPLE_MAX) shiftSamples(buf,NULL,num);
    for(int i=0;i<num;i++) {
        buf->samples[i+buf->used]=append[i];
    }
    buf->used+=num;
    //fprintf(stderr,"pushSamples: g_samples_used: %d\n",buf->used);
}
// マイクから受け取ったサンプルの保存されている数を返す
int getRecordedSampleCount() {
    return g_recbuf->used;
}
// マイクから受け取って保存されているサンプルを1個取得する
short getRecordedSample(int index) {
    return g_recbuf->samples[index];
}
// 再生するサンプルを1サンプルだけ送る。
void pushSamplesForPlay(short *samples, int num) {
    pushSamples(g_playbuf,samples,num);
}


///////////////////

// Direct Sound 特有の処理

#pragma comment(lib, "dsound.lib")
#pragma comment(lib, "dxguid.lib")

#define SAMPLE_RATE 24000
#define NUM_CHANNELS 1
#define BITS_PER_SAMPLE 16
#define BUFFER_SIZE (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE / 8)

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
    wfx.nSamplesPerSec = SAMPLE_RATE;
    wfx.wBitsPerSample = BITS_PER_SAMPLE;
    wfx.nChannels = NUM_CHANNELS;
    wfx.nBlockAlign = (wfx.wBitsPerSample / 8) * wfx.nChannels;
    wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;
    wfx.cbSize = 0;

    DSCBUFFERDESC dscbd;
    ZeroMemory(&dscbd, sizeof(dscbd));
    dscbd.dwSize = sizeof(dscbd);
    dscbd.dwBufferBytes = BUFFER_SIZE;
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
    wfx.nSamplesPerSec = SAMPLE_RATE;
    wfx.wBitsPerSample = BITS_PER_SAMPLE;
    wfx.nChannels = NUM_CHANNELS;
    wfx.nBlockAlign = (wfx.wBitsPerSample / 8) * wfx.nChannels;
    wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;
    wfx.cbSize = 0;

    DSBUFFERDESC dsbd;
    ZeroMemory(&dsbd, sizeof(dsbd));
    dsbd.dwSize = sizeof(dsbd);
    dsbd.dwFlags = DSBCAPS_GLOBALFOCUS;
    dsbd.dwBufferBytes = BUFFER_SIZE;
    dsbd.lpwfxFormat = &wfx;

    if (FAILED(pDS->CreateSoundBuffer(&dsbd, &pDSBuffer, NULL))) {
        return -3;
    }

    return 0;
}

void update() 
{

    LPVOID readPtr1, readPtr2;
    DWORD readBytes1, readBytes2;

    LPVOID writePtr1, writePtr2;
    DWORD writeBytes1, writeBytes2;

    {
        pDSCaptureBuffer->Lock(0, 0, &readPtr1, &readBytes1, &readPtr2, &readBytes2, DSCBLOCK_ENTIREBUFFER);

        pushSamples(g_recbuf,(short*)readPtr1,readBytes1/2);
        if (readPtr2) {
            pushSamples(g_recbuf,(short*)readPtr2,readBytes2/2);
        }
        pDSCaptureBuffer->Unlock(readPtr1, readBytes1, readPtr2, readBytes2);
 
        pDSBuffer->Lock(0, 0, &writePtr1, &writeBytes1, &writePtr2, &writeBytes2, DSBLOCK_ENTIREBUFFER);

        if(g_playbuf->used>0) {
            int to_write=shiftSamples(g_playbuf,(short*)writePtr1,writeBytes1/2);
            if(to_write<writeBytes1/2) {
                shiftSamples(g_playbuf,(short*)writePtr2,(writeBytes1/2)-to_write);
            }
        }
        else {
            memset(writePtr1,0,writeBytes1);
            if (writePtr2) {
                memset(writePtr2,0,writeBytes2);
            }
        }
        pDSBuffer->Unlock(writePtr1, writeBytes1, writePtr2, writeBytes2);

        pDSBuffer->Play(0, 0, DSBPLAY_LOOPING);
    }
}
void stop() {
    pDSCaptureBuffer->Stop();
    pDSBuffer->Stop();
}