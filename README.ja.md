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

## ブロックリファレンス

ブロックリファレンスは[`src/block-definitions.json`](src/block-definitions.json)から生成しています。生成された部分は手で編集しないでください。ブロックの表示文言はTurboWarp上の英語表記のままです。

<!-- BEGIN GENERATED BLOCKS -->

### `configure local relay [ENDPOINT]`

localhostで動くcapability-proxy中継のループバックoriginを設定します。以前のペアリングは消去されます。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `configureRelay` |
| `ENDPOINT` | 文字列, 既定値: `http://127.0.0.1:8787` |

### `pair local relay with one-time code [CODE]`

中継が表示した8桁のコードを、メモリだけに保持するセッションtokenと交換します。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `pairRelay` |
| `CODE` | 文字列, 既定値: `00000000` |

### `local relay paired?`

有効期限内の中継セッションtokenをメモリに保持しているかを返します。

| 項目 | 値 |
|---|---|
| 種類 | 真偽値ブロック |
| Opcode | `isRelayPaired` |

### `set instructions to [TEXT]`

次の接続で使うシステムへの指示（instructions）を設定します。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `setInstructions` |
| `TEXT` | 文字列, 既定値: `You are a friendly assistant. Answer briefly.` |

### `set voice to [VOICE]`

次の接続で使う応答の声を設定します。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `setVoice` |
| `VOICE` | 文字列, 既定値: `marin`, 選択肢: `alloy`, `ash`, `ballad`, `cedar`, `coral`, `echo`, `marin`, `sage`, `shimmer`, `verse` |

### `set output to [MODE]`

次の接続で、音声で応答するかテキストだけで応答するかを選びます。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `setOutputMode` |
| `MODE` | 文字列, 既定値: `audio`, 選択肢: `audio`, `text` |

### `set model to [MODEL]`

次の接続で使うRealtimeのモデルを選びます。中継の運用者が許可したモデルだけが使えます。空にすると中継の既定のモデルを使います。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `setModel` |
| `MODEL` | 文字列, 既定値: `gpt-realtime-2.1-mini`, 選択肢: `gpt-realtime-2.1-mini`, `gpt-realtime-2.1` |

### `set session time limit to [SECONDS] seconds`

次の接続から、指定した秒数が経つと自動で切断します。0にすると制限しません。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `setSessionTimeLimit` |
| `SECONDS` | 数値, 既定値: `600` |

### `connect to Realtime with microphone [MICROPHONE]`

中継を通じて一時キーを発行し、WebRTCのセッションを開きます。ツールとして公開した関数はモデルから呼べるようになります。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `connect` |
| `MICROPHONE` | 文字列, 既定値: `on`, 選択肢: `on`, `off` |

### `disconnect from Realtime`

WebRTCのセッションを閉じてマイクを止め、実行中の関数呼び出しを失敗させます。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `disconnect` |

### `connected to Realtime?`

Realtimeのセッションが開いているかを返します。

| 項目 | 値 |
|---|---|
| 種類 | 真偽値ブロック |
| Opcode | `isConnected` |

### `Realtime connection state`

disconnected、connecting、connected、failedのいずれかを返します。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `connectionState` |

### `Realtime model`

現在または直前の接続で中継が使ったモデルを返します。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `currentModel` |

### `session elapsed seconds`

現在のセッションが接続してからの秒数を返します。切断中は0を返します。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `sessionElapsed` |

### `when session time limit is reached`

セッションの時間上限によって切断されたときに起動します。

| 項目 | 値 |
|---|---|
| 種類 | ハット |
| Opcode | `whenSessionTimeLimitReached` |

### `send text [TEXT]`

利用者のテキストメッセージを会話に追加し、応答を要求します。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `sendText` |
| `TEXT` | 文字列, 既定値: `Hello!` |

### `when assistant finishes responding`

アシスタントのテキストまたは音声の書き起こしを含む応答が完了したときに起動します。

| 項目 | 値 |
|---|---|
| 種類 | ハット |
| Opcode | `whenResponseDone` |

### `last assistant response`

直近に完了したアシスタントの応答のテキスト、または音声の書き起こしを返します。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `lastResponseText` |

### `define function [NAME] description [DESCRIPTION] args schema [SCHEMA] export as [EXPORT]`

関数を定義します。export asをtoolにすると、モデルから呼べるツールになります。NAME、DESCRIPTION、SCHEMAには文字列を直接書く必要があります。

| 項目 | 値 |
|---|---|
| 種類 | ハット |
| Opcode | `defineFunction` |
| `NAME` | 文字列, 既定値: `get_score` |
| `DESCRIPTION` | 文字列, 既定値: `Returns the player's current score.` |
| `SCHEMA` | 文字列, 既定値: `{"type":"object","properties":{}}` |
| `EXPORT` | 文字列, 既定値: `tool`, 選択肢: `tool`, `none` |

### `function argument [PATH]`

関数の中で、cityやitems.0.nameのようなドット区切りのパスにある引数を返します。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `functionArgument` |
| `PATH` | 文字列, 既定値: `city` |

### `function arguments JSON`

関数の中で、すべての引数をJSONテキストとして返します。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `functionArgumentsJson` |

### `return [VALUE]`

関数の中で値を返し、スクリプトを終了します。JSONテキストはJSONとして、それ以外のテキストは文字列として返します。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `returnValue` |
| `VALUE` | 文字列, 既定値: `{"score":10}` |

### `Realtime usage [FIELD]`

最後にリセットしてからの使用量の合計を返します。costUSDは公開価格からの概算で、正確な請求額はOpenAIの管理画面で確認してください。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `usageValue` |
| `FIELD` | 文字列, 既定値: `costUSD`, 選択肢: `costUSD`, `responses`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `textInputTokens`, `audioInputTokens`, `textOutputTokens`, `audioOutputTokens` |

### `reset Realtime usage`

使用量の合計を0に戻します。

| 項目 | 値 |
|---|---|
| 種類 | コマンド |
| Opcode | `resetUsage` |

### `last Realtime error`

直近の中継、接続、APIのエラーを返します。エラーがなければ空文字列を返します。

| 項目 | 値 |
|---|---|
| 種類 | 値ブロック |
| Opcode | `lastError` |

<!-- END GENERATED BLOCKS -->

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
| `set model to` | モデルは次の接続で送られる。中継は`allowedModels`に載っているモデルだけを受け付ける。空にすると中継の既定のモデルを使う。実際に使われたモデルは`Realtime model`でわかる |
| `set session time limit to` | 次の接続から、指定した秒数が経つとセッションを切断し、`when session time limit is reached`を起動する。0にすると制限しない |
| `Realtime usage [FIELD]` | 最後にリセットしてからのすべての`response.done`（関数呼び出しの往復も含む）の合計。`costUSD`は公開価格からの概算（`src/usage.ts`）で、正確な請求額はOpenAIの管理画面で確認する |

## Composition API

Composition APIをimportしても、単独のTurboWarp機能拡張は登録されません。音声会話の拡張などの下流の拡張が、自分のブロックとハットを持ち、処理をこのAPIに渡します。関数は[`@kubohiroya/turbowarp-named-functions`](https://github.com/kubohiroya/turbowarp-named-functions)を使います。下流の拡張も同じ関数を使う場合は、`functions`に共有のインスタンスを渡します。使い方は[英語版README](README.md#composition-api)を参照してください。

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

## ライセンス

[Mozilla Public License 2.0](LICENSE) (SPDX: `MPL-2.0`).
