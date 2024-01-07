#


binding: NativeAudioMac.o
	rm -f NativeAudioMac.node NativeAudioMac.node.arm64 NativeAudioMac.node.x86_64
	node-gyp clean configure build --verbose --arch=x64
	mv build/Release/NativeAudioMac.node ./NativeAudioMac.node.x86_64
	node-gyp clean configure build --verbose --arch=arm64
	mv build/Release/NativeAudioMac.node ./NativeAudioMac.node.arm64
	lipo -create -output NativeAudioMac.node NativeAudioMac.node.arm64 NativeAudioMac.node.x86_64
	cp ./NativeAudioMac.node ../../app/

NativeAudioWin.dll : NativeAudioWin.cpp
	cl.exe /LD NativeAudioWin.cpp


#NativeAudioMac.o : NativeAudioMac.m
#	clang -arch arm64 -arch x86_64 NativeAudioMac.m -c

# NAPI用、m1macでうまく動かん
#NativeAudioMac.dylib : NativeAudioMac.m
#	clang -dynamiclib -framework CoreAudio -framework Foundation -framework AudioToolbox NativeAudioMac.m -o NativeAudioMac.dylib
#	clang -dynamiclib -arch arm64 -arch x86_64 -framework CoreAudio -framework Foundation -framework AudioToolbox NativeAudioMac.m -o NativeAudioMac.dylib


