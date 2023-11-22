#include <node.h>
#include "NativeAudioMac.h"
#include <stdio.h>





using namespace v8;

const char* hello() {
    return "Hello from C!";
}

void NativeAudio_initSampleBuffers(const FunctionCallbackInfo<Value>& args) {
    initSampleBuffers();
    Isolate* isolate = args.GetIsolate();
    args.GetReturnValue().Set(Undefined(isolate));    
}
void NativeAudio_startMic(const FunctionCallbackInfo<Value>& args) {
    int r=startMic();
    Isolate* isolate = args.GetIsolate();
    args.GetReturnValue().Set(Integer::New(isolate, r));
}
void NativeAudio_listDevices(const FunctionCallbackInfo<Value>& args) {
    listDevices();
    Isolate* isolate = args.GetIsolate();
    args.GetReturnValue().Set(Undefined(isolate));
}
void NativeAudio_startSpeaker(const FunctionCallbackInfo<Value>& args) {
    int r=startSpeaker();
    Isolate* isolate = args.GetIsolate();
    args.GetReturnValue().Set(Integer::New(isolate, r));
}
void NativeAudio_pushSamplesForPlay(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    if (args.Length() < 1 || !args[0]->IsInt16Array()) {
        isolate->ThrowException(Exception::TypeError(
            String::NewFromUtf8(isolate, "Expected an Int16Array", NewStringType::kNormal).ToLocalChecked()));
        return;
    }

    Local<Int16Array> int16Array = args[0].As<Int16Array>();
    std::shared_ptr<BackingStore> backingStore = int16Array->Buffer()->GetBackingStore();
    int16_t* data = static_cast<int16_t*>(backingStore->Data());
    size_t length = backingStore->ByteLength() / sizeof(int16_t);
    //    for (size_t i = 0; i < length; ++i) printf("%d ", data[i]);

    pushSamplesForPlay(data,length);
    
    args.GetReturnValue().Set(Integer::New(isolate, length));
}
void NativeAudio_getRecordedSamples(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    int arraySize = getRecordedSampleCount();
    Local<ArrayBuffer> buffer = ArrayBuffer::New(isolate, arraySize * sizeof(int16_t));
    Local<Int16Array> int16Array = Int16Array::New(buffer, 0, arraySize);
    std::shared_ptr<BackingStore> backingStore = int16Array->Buffer()->GetBackingStore();
    int16_t* data = static_cast<int16_t*>(backingStore->Data());
    for(int i=0;i<arraySize;i++) data[i]=getRecordedSample(i);
    args.GetReturnValue().Set(int16Array);    
}
void NativeAudio_discardRecordedSamples(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();    
    if (args.Length() != 1 || !args[0]->IsNumber()) {
        isolate->ThrowException(Exception::TypeError(String::NewFromUtf8(isolate, "Expected a single integer argument", NewStringType::kNormal).ToLocalChecked()));
        return;
    }
    int len = args[0]->NumberValue(isolate->GetCurrentContext()).FromJust();
    discardRecordedSamples(len);
    args.GetReturnValue().Set(Undefined(isolate));    
}


void Initialize(Local<Object> exports) {
    fprintf(stderr,"Initialize\n");
    NODE_SET_METHOD(exports, "initSampleBuffers", NativeAudio_initSampleBuffers);
    NODE_SET_METHOD(exports, "startMic", NativeAudio_startMic);
    NODE_SET_METHOD(exports, "listDevices", NativeAudio_listDevices);        
    NODE_SET_METHOD(exports, "startSpeaker", NativeAudio_startSpeaker);
    NODE_SET_METHOD(exports, "pushSamplesForPlay", NativeAudio_pushSamplesForPlay);
    NODE_SET_METHOD(exports, "getRecordedSamples", NativeAudio_getRecordedSamples);
    NODE_SET_METHOD(exports, "discardRecordedSamples", NativeAudio_discardRecordedSamples);            
    
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Initialize)
