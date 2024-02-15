{
    "targets": [
        {
            "target_name": "NativeAudioWin",
            "sources": [ "NativeAudioWinWrap.cpp", "NativeAudioWin.cpp" ],
            "conditions": [
                ["OS=='win'", {
                    "libraries": [ ],
                    "link_settings": {
                        "libraries": [
                            
                        ]
                    },            
                }]
            ]
        }
    ]
}
