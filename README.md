# NodePhone
A minimum command line voice chat app by node.

最小のコマンドラインボイスチャットアプリ。


# server

NodePhoneのサーバーです。


install:

```
npm i ws
```

run:

```
node sv.js
```



# phone app

NodePhoneのクライアントアプリ本体です。

macos install:

Tested on node v16.13.0 and macos 12.3.1, using homebrew

```
arch -x86_64 zsh
npm i node-record-lpcm16
npm i speaker  # this need x86_64
```


run:

```
node phone.js
```

# recplay app

recplayは、マイクとスピーカーのテストをするだけのアプリです。
自分の声をスピーカーから再生します。
そのため、ノートPCなどの、スピーカーから再生した音声がそのままマイクから入力される環境で実行すると、
ハウリングします。(エコーキャンセルしないため)

インストール方法は phone.jsと同じです。

run recplay:

```
node recplay.js
```



# cancel app

cancelは、recplayに対してエコーキャンセル機能を追加したものです。
recplayではハウリングする環境でも、エコーキャンセルが働くことにより、
ハウリングが起きません。

インストール方法は phone.jsと同じです。

実行方法:

```
node cancel.js
```

