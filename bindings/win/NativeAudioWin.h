

#define EXPORT __declspec(dllexport)

extern "C" {
    EXPORT void initSampleBuffers(int recFreq,int playFreq);
    EXPORT int getRecordedSampleCount();
    EXPORT short getRecordedSample(int index);
    EXPORT void pushSamplesForPlay(short *samples, int num);
    EXPORT int startMic();
    EXPORT int listDevices();
    EXPORT int startSpeaker();
    EXPORT void update();
    EXPORT void stopMic();
    EXPORT void stopSpeaker();
    EXPORT int getRecordedSamples(short *samples_out, int maxnum);
    EXPORT int getPlayBufferUsed();    
    EXPORT void discardRecordedSamples(int num); 
};
