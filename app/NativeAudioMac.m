// macOSでオーディオデバイスを使うためのnpmにはspeakerやsox,node-record-lcpm16などがあるが、
// Intel環境を必要とするとか、特定のNodeバージョンで動かない問題があったので、
// C言語で独自に実装して、nodeのFFIから使うことにした。



#include <Foundation/Foundation.h>
#include <AudioToolbox/AudioToolbox.h>

#define kNumberBuffers 3

int g_echoback=0; // これを1 にすると、エコーバックする(ハウリングに注意)

bool g_debug=0; // 1にすると、再生用サンプルをファイルに保存する


int g_recFreq=32000;
int g_playFreq=32000;

/*
 SampleBuffer
 サンプルデータを格納しておく構造体
 
 */
typedef struct
{
#define SAMPLE_MAX 64000
    short samples[SAMPLE_MAX];
    int used;
} SampleBuffer;

SampleBuffer *g_recbuf; // 録音したサンプルデータ
SampleBuffer *g_playbuf; // 再生予定のサンプルデータ

// 必要なSampleBufferを初期化する
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
    // output
    if(output) for(int i=0;i<to_output;i++) output[i]=buf->samples[i];
    // shift
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
    if(g_debug) {
        FILE *fp=fopen("debug.pcm16le","a+");
        fwrite(samples,1,num*2,fp);
        fclose(fp);
    }
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
/*--------*/

// AudioQueueRefとその他の情報を格納
typedef struct {
    AudioStreamBasicDescription dataFormat;
    AudioQueueRef queue;
    AudioQueueBufferRef buffers[kNumberBuffers];
} RecordState;

// コールバック関数
static void HandleInputBuffer(
    void *inUserData,
    AudioQueueRef inAQ,
    AudioQueueBufferRef inBuffer,
    const AudioTimeStamp *inStartTime,
    UInt32 inNumPackets,
    const AudioStreamPacketDescription *inPacketDesc
) {
    // inBufferには録音データが入っているので、ここで処理を行う
    if (inNumPackets > 0) {
        short *audioData = (short *)inBuffer->mAudioData;
        pushSamples(g_recbuf,audioData,inNumPackets);
        if(g_echoback) pushSamples(g_playbuf,audioData,inNumPackets);
    }
    
    // バッファを再度エンキュー
    OSStatus st= AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
    if(st!=noErr) {
        printf("AudioQueueEnqueueBuffer fail:%d\n",st);
    }
}



int startMic() {
    @autoreleasepool {
        RecordState recordState;
        memset(&recordState, 0, sizeof(RecordState));

        // オーディオデータフォーマットの設定
        recordState.dataFormat.mSampleRate = g_recFreq;
        recordState.dataFormat.mFormatID = kAudioFormatLinearPCM;
        recordState.dataFormat.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked | kAudioFormatFlagsNativeEndian;
        recordState.dataFormat.mBytesPerPacket = 2;
        recordState.dataFormat.mFramesPerPacket = 1;
        recordState.dataFormat.mBytesPerFrame = 2;
        recordState.dataFormat.mChannelsPerFrame = 1;
        recordState.dataFormat.mBitsPerChannel = 16;

        // オーディオキューの作成
        OSStatus st=AudioQueueNewInput(&recordState.dataFormat, HandleInputBuffer, &recordState, NULL, kCFRunLoopCommonModes, 0, &recordState.queue);
        if(st!=noErr) return st;
        // バッファの確保とエンキュー
        for (int i = 0; i < kNumberBuffers; ++i) {
            AudioQueueAllocateBuffer(recordState.queue, 2048, &recordState.buffers[i]);
            AudioQueueEnqueueBuffer(recordState.queue, recordState.buffers[i], 0, NULL);
        }
        // 録音開始
        st=AudioQueueStart(recordState.queue, NULL);
        if(st!=noErr) return st;
    }
    return 0;
}




int listDevices() {
    @autoreleasepool {
        AudioObjectPropertyAddress propertyAddress = {
            kAudioHardwarePropertyDevices,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };

        UInt32 dataSize = 0;
        OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &propertyAddress, 0, NULL, &dataSize);
        if (status != noErr) {
            NSLog(@"Error %d getting devices' data size", status);
            return 1;
        }

        UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
        AudioDeviceID *audioDevices = malloc(dataSize);
        
        status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &propertyAddress, 0, NULL, &dataSize, audioDevices);
        if (status != noErr) {
            NSLog(@"Error %d getting devices' data", status);
            return 1;
        }

        for (UInt32 i = 0; i < deviceCount; ++i) {
            AudioDeviceID deviceID = audioDevices[i];

            CFStringRef deviceName = NULL;
            dataSize = sizeof(deviceName);
            propertyAddress.mSelector = kAudioDevicePropertyDeviceNameCFString;

            status = AudioObjectGetPropertyData(deviceID, &propertyAddress, 0, NULL, &dataSize, &deviceName);
            if (status == noErr) {
                NSLog(@"Device ID: %u, Name: %@", deviceID, deviceName);
                CFRelease(deviceName);
            } else {
                NSLog(@"Error %d getting device name", status);
            }
        }

        free(audioDevices);
    }
    return 0;
}




/*------*/
static OSStatus RenderCallback(void *inRefCon,
                               AudioUnitRenderActionFlags *ioActionFlags,
                               const AudioTimeStamp *inTimeStamp,
                               UInt32 inBusNumber,
                               UInt32 inNumberFrames,
                               AudioBufferList *ioData)
{
    static short tmp[8192];
    unsigned int n=inNumberFrames;
    if(n>8192)n=8192;
    unsigned int shifted=shiftSamples(g_playbuf,tmp,n);
    //    printf("render inNumberFrames:%d shifted:%d tmp0:%d n:%d\n",inNumberFrames,shifted,tmp[0],n);
    SInt16 *outFrames = (SInt16*)(ioData->mBuffers->mData);
    for(unsigned int i=0;i<n;i++) {
        short sample=0;
        if(i<shifted)sample=tmp[i];
        outFrames[i]=sample;
    }
    return noErr;
}

int startSpeaker() {
    AudioComponentInstance audioUnit;
    AudioComponentDescription desc;

    desc.componentType = kAudioUnitType_Output;
    desc.componentSubType = kAudioUnitSubType_DefaultOutput;
    desc.componentManufacturer = kAudioUnitManufacturer_Apple;
    desc.componentFlags = 0;
    desc.componentFlagsMask = 0;

    AudioComponent comp = AudioComponentFindNext(NULL, &desc);
    AudioComponentInstanceNew(comp, &audioUnit);

    // チャンネル数を設定
    AudioStreamBasicDescription audioFormat;
    memset(&audioFormat, 0, sizeof(AudioStreamBasicDescription));
    audioFormat.mSampleRate = g_playFreq;
    audioFormat.mFormatID = kAudioFormatLinearPCM;
    audioFormat.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
    audioFormat.mFramesPerPacket = 1;
    audioFormat.mChannelsPerFrame = 1;
    audioFormat.mBitsPerChannel = 16;
    audioFormat.mBytesPerFrame = 2;
    audioFormat.mBytesPerPacket = 2;

    OSStatus status = AudioUnitSetProperty(audioUnit,
                                  kAudioUnitProperty_StreamFormat,
                                  kAudioUnitScope_Input,
                                  0,
                                  &audioFormat,
                                  sizeof(AudioStreamBasicDescription));

    if (status != noErr) {
        fprintf(stderr,"AudioUnitSetProperty streamformat: error:%d\n",status);
        return status;
    }
    
    
    
    
    AURenderCallbackStruct callbackStruct;
    callbackStruct.inputProc = RenderCallback;
    callbackStruct.inputProcRefCon = audioUnit;

    status=AudioUnitSetProperty(audioUnit,
                         kAudioUnitProperty_SetRenderCallback,
                         kAudioUnitScope_Output,
                         0,
                         &callbackStruct,
                         sizeof(callbackStruct));
    if(status!=noErr) {
        fprintf(stderr,"AudioUnitSetProperty rendercallback: error:%d\n",status);
        return status;
    }

    status=AudioUnitInitialize(audioUnit);
    if(status!=noErr) {
        fprintf(stderr,"AudioUnitInitialize: error:%d\n",status);
        return status;
    }

    status=AudioOutputUnitStart(audioUnit);
    if(status!=noErr) {
        fprintf(stderr,"AudioOutputUnitStart: error:%d\n",status);
        return status;
    }

/*
 TODO
    AudioOutputUnitStop(audioUnit);
    AudioUnitUninitialize(audioUnit);
    AudioComponentInstanceDispose(audioUnit);
*/
    return 0;
}

