{
    "targets": [
        {
            "target_name": "NativeAudioMac",
            "sources": [ "NativeAudioMacWrap.cpp", "NativeAudioMac.m" ],
            "conditions": [
                ["OS=='mac'", {
                    "libraries": [ ],
                    "link_settings": {
                        "libraries": [
                            "-framework AudioToolbox"
                        ]
                    },            
                }],
                ["OS=='win'", {
                    "libraries": [ "<!(pwd)/path/to/your/object_file.obj" ]
                }],
                ["OS=='linux'", {
                    "libraries": [ "<!(pwd)/path/to/your/object_file.o" ]
                }]
            ]
        }
    ]
}
