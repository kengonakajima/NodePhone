{
    "targets": [
        {
            "target_name": "NativeAudioWin",
            "sources": [ "NativeAudioWinWrap.cpp", "NativeAudioWin.cpp" ],
            'include_dirs': [
                'pa/include',
            ],
            "conditions": [
                ["OS=='win'", {
                    "libraries": [ "../pa/x64/Release/portaudio_x64.lib" ],
                    "link_settings": {
                        "libraries": [
                            
                        ]
                    },            
                }]
            ]
        }
    ]
}
