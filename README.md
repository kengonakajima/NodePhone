# NodePhone

最小構成のコマンドラインボイスチャットアプリです。
エコーキャンセル機能をもつので、ノートPC等を用いて、イヤホンなしでリモートのユーザーと通話ができます。

サーバに接続するすべてのユーザーの声が聞こえます。
部屋を分離するには複数のサーバーを起動する必要があります。

デモ用のサーバは、  172.105.239.246 で起動しています。


# server ディレクトリ

NodePhoneのサーバーです。 
```npm install```  で必要なnpmをインストールし、
```node sv.js``` で起動するだけです。
TCP 13478ポートでWebSockets接続を待機します。

クライアント用アプリである、 phone.js がこのサーバーに接続して互いに通信します。
Ubuntu 22.04LTSのnode.js 12.22で動作確認しています。


# phone app

NodePhoneの通話クライアントアプリ本体です。
macOS 12.3.1,Homebrew, node v16.13.0 でテストしています。

インストールするには以下のように Rosetta2 のx86_64環境が必要です。
これは音を再生するためのNPMである、 speaker がx86_64に依存しているためです。

```
arch -x86_64 zsh
brew install sox
npm i node-record-lpcm16
npm i speaker  # this need x86_64
```

通話クライアントを実行するには以下のようにします。

```
node phone.js                              # デフォルトのサーバに接続してほかのユーザーとの通話を開始します。
node phone.js --echoback                   # デフォルトのサーバに接続して、エコー通話（マイクテスト）を開始します。
node phone.js 172.105.239.246              # 172.105.239.246のサーバに接続して、ほかのユーザーとの通話を開始します。
node phone.js 172.105.239.246 --echoback   # 172.105.239.246のサーバに接続して、エコー通話（マイクテスト）を開始します。
node phone.js 172.105.239.246 --echoback --disable_aec   # 172.105.239.246のサーバに接続して、エコー通話（マイクテスト）を開始しますが、エコーキャンセラをオフにします。
```




# recplay app

recplayは、マイクとスピーカーのテストをするだけのアプリです。
自分の声をスピーカーから再生します。
そのため、ノートPCなどの、スピーカーから再生した音声がそのままマイクから入力される環境で実行すると、
ハウリングします。(エコーキャンセルしないため)

インストール方法は phone.jsと同じです。
```node recplay.js ```として起動します。



# cancel app

cancelは、recplayに対してエコーキャンセル機能を追加したものです。
recplayではハウリングする環境でも、エコーキャンセルが働くことにより、ハウリングが起きません。

インストール方法は phone.jsと同じです。

```node cancel.js```として起動します。

