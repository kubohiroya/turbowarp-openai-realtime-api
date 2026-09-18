# TurboWarp-OpenAI-Realtime-API

[English](README.md) | [日本語](README.ja.md)

OpenAI Realtime APIと音声やテキストで会話し、ブロックで書いた関数をモデルから呼び出せるようにするTurboWarp機能拡張です。OpenAIのAPIキーはlocalhostの中継に置いたままで、ブラウザには短時間だけ有効な一時キーしか渡しません。

**利用ガイド:** [English](https://kubohiroya.github.io/turbowarp-openai-realtime-api/)

## できること

- TurboWarpのプロジェクトをWebRTCでOpenAI Realtime APIにつなぐ（マイクあり／なし）
- テキストを送り、アシスタントの応答テキストまたは音声の書き起こしを受け取る
- `define function ... export as tool` のスクリプトをモデルが呼べるツールにし、スクリプトの `return` の値をモデルに返す
- OpenAIのAPIキーは、localhostで動く[`@kubohiroya/capability-proxy`](https://github.com/kubohiroya/capability-proxy)に置いたままにする。拡張はワンタイムコードで中継とペアリングし、接続のたびに一時キーを受け取る

## 動作条件と安全上の注意

- カスタム機能拡張を使えるTurboWarp DesktopまたはTurboWarp Web
- `openai` providerを設定して`127.0.0.1`で起動した[`@kubohiroya/capability-proxy`](https://github.com/kubohiroya/capability-proxy)
- WebRTCとマイクが使えるブラウザ。応答の音声はページから再生される

> [!IMPORTANT]
> この機能拡張は、マイク、WebRTC、localhostの中継、関数スクリプトを起動するためのVMランタイムを使うため、サンドボックスなしで実行する必要があります。
> 信頼できる配布元の機能拡張だけを読み込んでください。

- 中継のendpointは `http://127.0.0.1:8787` のようなループバックのoriginに限ります。中継のtokenがこのマシンの外に出ないよう、それ以外のhostは拒否します。
- 中継のtokenと一時キーは実行時のメモリだけに保持し、ブロックや `.sb3` には保存しません。
- ツールとして公開した関数は、モデルが選んだ引数で呼ばれます。引数はすべて信頼できない入力として扱ってください。

## インストール

1. [`dist/turbowarp-openai-realtime-api.js`](dist/turbowarp-openai-realtime-api.js?raw=1)をダウンロードします。
2. TurboWarpで**機能拡張**を開きます。
3. **カスタム機能拡張**からfileを読み込みます。
4. **サンドボックスなしで実行する**を有効にします。

npm packageとして使う場合は、検証済みのversionをexact pinします。

```bash
pnpm add --save-exact @kubohiroya/turbowarp-openai-realtime-api@0.1.0
```

## クイックスタート

1. `openai` providerを設定した`capability-proxy`を起動し、表示された8桁のペアリングコードを控えます（設定方法は同READMEを参照）。
2. この機能拡張をサンドボックスなしで読み込みます。
3. 次のブロックを実行し、マイクに話しかけるか、`send text`を使います。

```text
configure local relay [http://127.0.0.1:8787]
pair local relay with one-time code [12345678]
set instructions to [You are a friendly assistant. Answer briefly.]
connect to Realtime with microphone [on]
send text [Hello!]

when assistant finishes responding
say (last assistant response)

define function [get_score] description [Returns the player's score.] args schema [{"type":"object","properties":{}}] export as [tool]
return (join [{"score":] (join (score) [}]))
```

ブロックの一覧は[英語版README](README.md#block-reference)を参照してください。

## 重要な動作

| 状況 | 動作 |
|---|---|
| 中継のendpointがループバックのoriginでない | `last Realtime error`にエラーを記録し、以前のendpointを維持する |
| ペアリング前、または中継のセッションが期限切れの状態で接続する | `connect`はエラーを記録し、OpenAIには接続しない |
| `define function`のハットが不正（NAME／DESCRIPTION／SCHEMAが文字列の直書きでない、JSON Schemaが不正、名前の重複、descriptionのないツール） | `connect`は問題をすべて記録し、接続しない |
| 接続中に設定を変えた | instructions、voice、出力、ツールは次の接続から反映される |
| モデルが関数を呼んだ | すべての`define function`ハットが起動され、NAMEが一致したものだけが実行を続ける。`return`の値をJSONとして返し、新しい応答を要求する |
| 関数のスクリプトが`return`なしで終わった | 結果は`null`になる |
| 関数が30秒以内に終わらない | モデルには`{"error": "Function ... timed out."}`を返す |
| 同じ関数を続けて呼ばれた | 1つずつ順番に実行する。異なる関数は並行して実行する |
| ツールとして公開していない関数をモデルが呼んだ | 呼び出しを拒否し、モデルにエラーを返す |
| プロジェクトの停止 | 実行中・待機中の関数呼び出しは失敗する。Realtimeのセッションは`disconnect`まで維持する |
| 切断、または接続が切れた | マイクを解放し、音声を止め、実行中の関数呼び出しは失敗する |

## 開発

Node.js 22.18.0以上と、`packageManager`で指定したpnpmを使います。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

本物のTurboWarp VMをブラウザなしで動かす結合テストも実行する場合は、`SCRATCH_VM_PATH`にTurboWarpの`scratch-vm`の場所を指定します。

```bash
SCRATCH_VM_PATH=/path/to/TurboWarp/scratch-vm pnpm test
```

サーバ層ブロックの設計メモは[`docs/block-catalog.ja.md`](docs/block-catalog.ja.md)、関連研究は[`docs/related-work.ja.md`](docs/related-work.ja.md)にあります。

## ライセンス

[Mozilla Public License 2.0](LICENSE) (SPDX: `MPL-2.0`).
