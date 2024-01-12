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
                }]
            ]
        }
    ]
}
