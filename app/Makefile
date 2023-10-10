#
NativeAudioMac.dylib : NativeAudioMac.m
	clang -dynamiclib -framework CoreAudio -framework Foundation -framework AudioToolbox NativeAudioMac.m -o NativeAudioMac.dylib


NativeAudioWin.dll : NativeAudioWin.cpp
	cl.exe /LD NativeAudioWin.cpp


