extern "C"
{
    void initSampleBuffers();
    int startMic(void);
    int listDevices();
    int startSpeaker();
    void pushSamplesForPlay(short *samples, int num);
    short getRecordedSample(int index);
    int getRecordedSampleCount();
    int getRecordedSamples(short *samples_out, int maxnum);
    int getPlayBufferUsed();    
    void discardRecordedSamples(int num);
};

