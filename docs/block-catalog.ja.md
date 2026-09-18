# サーバ層ブロック一覧と2モードの実現方法（設計文書 草稿）

## 0. この文書の位置づけ

.sb3 から取り出したサーバ層スクリプトは、次の2つのモードで実行する。

| モード | 実行場所 | 用途 |
|---|---|---|
| **bridge** | ブラウザ上の TurboWarp VM。ローカルの bridge サーバ（Hono）と WebSocket でつながる | 開発、デバッグ、差分テストの正解（オラクル） |
| **compiled** | Hono 上の IR インタプリタ（Cloudflare Workers / Node.js） | 配置 |

この文書では、サーバ層で使えるブロックを定義し、ブロックごとに2つのモードでの実現方法を定める。

**採否の基準：** 2つのモードのどちらかで同じ意味を実現できないブロックは、サーバ層のサブセットに含めない。

## 1. 共通のアーキテクチャ

```
                ┌──────────── bridge モード ────────────┐
TurboWarp VM ──(WS: request / effect RPC)──▶ bridge サーバ (Hono, Node)
  ├ Scratch 標準ブロック: VM が実行                    ├ Adapter: SQLite / KV / Session / Fetch / Secrets …
  └ 拡張ブロック                                       └ HTTP 受け口, Realtime サイドバンド
     ├ 純関数ブロック: 共有ランタイム(TS)をブラウザで実行
     └ 副作用ブロック: effect RPC で bridge サーバの Adapter を呼ぶ

                ┌──────────── compiled モード ──────────┐
Hono ─▶ IR インタプリタ
          ├ Scratch 標準ブロック: IR で再実装（Cast 等を移植）
          ├ 純関数ブロック: 共有ランタイム(TS)をそのまま呼ぶ
          └ 副作用ブロック: 同じ Adapter インタフェース（D1 / KV / DO / R2 …）
```

設計の原則は次の4つである。

1. **純関数ブロックの実装は1つにする。** JSON 操作、暗号、検証などは共有ランタイム（TypeScript）に1つだけ実装し、2つのモードで同じコードを使う。これにより、構成の段階で同じ意味になることが保証される。
2. **副作用ブロックはどちらのモードでもサーバ側で実行する。** bridge モードでも、DB、KV、セッション、外部 HTTP 通信、秘密情報はブラウザに置かない。モード間の違いは Adapter の差し替えだけにする。
3. **差分テストの主な対象は Scratch 標準ブロックの意味論にする。** 2つのモードの実装が本当に分かれているのは、VM と IR インタプリタの部分だけだからである。
4. **bridge モードではリクエストを1件ずつ処理する。** Scratch の変数をリクエスト単位のローカル変数として扱うための前提である（§3.3）。

## 2. 表の見方

- **優先度：** P0（基盤）、P1（永続化と識別）、P2（運用と規模）、既存（`turbowarp-http-server` にすでにある）
- **bridge 列：**
  - `VM`：TurboWarp VM がそのまま実行する
  - `共有RT@ブラウザ`：共有ランタイムを拡張の中で実行する
  - `RPC`：bridge サーバの Adapter を呼び出す
- **compiled 列：**
  - `IR`：IR インタプリタの組込み処理
  - `共有RT`：共有ランタイムを呼び出す
  - `Adapter(…)`：Workers または Node の実装
- **差分：** 差分テストでの扱い
  - ◎：実装が共通なので対象外でよい
  - ○：比較できる
  - △：時計、乱数、外部依存があり、固定値や偽物への置き換えが必要
  - —：比較しない

## 3. Scratch 標準ブロック（許可リスト）

### 3.1 許可するもの

| 分類 | opcode | bridge | compiled | 制約・検査 | 差分 |
|---|---|---|---|---|---|
| 演算 | `operator_add` `_subtract` `_multiply` `_divide` `_mod` `_round` `_mathop` | VM | IR（scratch-vm の `Cast` と `MathUtil` を移植） | なし | ○（最重点：NaN、Infinity、-0、数値の表示形式） |
| 比較・論理 | `operator_gt` `_lt` `_equals` `_and` `_or` `_not` | VM | IR（`Cast.compare` を移植。大文字と小文字を区別しない、数値として比較できる文字列） | なし | ○（最重点） |
| 文字列 | `operator_join` `_letter_of` `_length` `_contains` | VM | IR（1始まりの添字。サロゲートペアの扱いは VM に合わせる） | なし | ○ |
| 乱数 | `operator_random` | VM | IR | 暗号用途には使えない旨を警告する。テスト時はシードを固定する | △ |
| 分岐 | `control_if` `control_if_else` | VM | IR | なし | ○ |
| 反復 | `control_repeat` `control_repeat_until` `control_while` `control_for_each` | VM | IR | スクリプトを「画面を再描画せずに実行」で動かすことを必須にする。実行量の上限（fuel）を超えたら 500 を返す | ○（上限の範囲内のみ） |
| 終了 | `control_stop`（`this script` のみ） | VM | IR（ハンドラを終える。応答していなければ既定の応答を返す） | `all` と `other scripts` は禁止 | ○ |
| 変数 | `data_variable` `data_setvariableto` `data_changevariableby` | VM | IR（**呼び出し1回ごとのローカル変数**） | §3.3 の規則に従う | ○ |
| リスト | `data_listcontents` `data_addtolist` `data_deleteoflist` `data_deletealloflist` `data_insertatlist` `data_replaceitemoflist` `data_itemoflist` `data_itemnumoflist` `data_lengthoflist` `data_listcontainsitem` | VM | IR（呼び出し1回ごとのローカル変数） | §3.3 の規則に従う | ○ |
| 独自ブロック | `procedures_definition` `procedures_prototype` `procedures_call` `procedures_return` `argument_reporter_string_number` `argument_reporter_boolean` | VM（TurboWarp の戻り値つき独自ブロック） | IR（関数、呼び出しスタック、戻り値） | 「画面を再描画せずに実行」を必須にする。再帰は許可し、深さの上限（既定1000）を設ける。同じターゲットの中からしか呼べない | ○（深さの上限内のみ） |

### 3.2 除外するもの

| 分類 | 例 | 除外する理由 |
|---|---|---|
| 時間待ち・常駐 | `control_wait` `control_wait_until` `control_forever` | 呼び出し1回で完結する意味論に反する。CPU 時間の制限もある。VM 側の決定性も損なう |
| 並行処理・メッセージ | `event_broadcast` `event_broadcastandwait` `event_whenbroadcastreceived` `event_whenflagclicked` など | スレッドをまたぐ意味論をサーバで再現できない |
| クローン | `control_create_clone_of` など | ステージとスプライトの状態に依存する |
| 見た目・動き・音・ペン | `looks_*` `motion_*` `sound_*` `pen_*` | レンダラが前提で、サーバでは意味を持たない |
| 調べる | `sensing_*`（時刻系も含む） | 入力装置やステージに依存する。時刻は §4.6 の専用ブロックで扱う |
| 変数モニタ | `data_showvariable` `data_hidevariable` など | 画面の表示に関わるブロックだから |
| 第三者の拡張 | 任意 | サーバ用の実装を同梱する、という約束がないため（§6） |

### 3.3 変数の規則

- サーバ層のスクリプトが使う**スプライト専用の変数とリストは、呼び出し1回ごとのローカル変数**として扱う。
  - compiled モードでは、呼び出しのたびに初期値（sb3 に保存されている値）から始める。
  - bridge モードでは、リクエストを1件ずつ処理し、処理を始める前に初期値へ戻す。
- **ステージ（全体）の変数への書き込みは禁止する。** 読むだけなら、配置時に決まる定数として扱う。
- 独自ブロックの中でスプライト変数に書き込んだ場合は警告する。関数は引数と戻り値だけで完結させるよう促す。
- リクエストをまたいで状態を持たせたい場合は、必ず §5 のストレージのブロックを使う。

## 4. 拡張ブロック：基盤（P0）

### 4.1 入口（ハット）

| ブロック（opcode 案） | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `when HTTP [METHOD] [PATH] received`（`whenHttpRequestReceived`） | 既存 | bridge サーバが受け取り、WS 経由でハットを起動する | Hono の route。path パラメータは Hono の書き方に変換する | 同じ method と path の組は1つまで | ○ |
| `define function … export as tool`（§4.8.2） | P0 | bridge サーバが持つ Realtime のサイドバンド WS から、関数値のハットを起動する | Durable Object のサイドバンド処理が IR の関数を呼ぶ | ツール名は一意にする。旧 `when tool [NAME] called` は廃止 | ○ |
| `test [NAME]`（`testCase`） | P1 | VM で実行する | IR で実行する | サーバ層にも配置物にも含めず、テストでだけ使う | — |

### 4.2 リクエストと応答

| ブロック | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `current HTTP method` / `request path` / `request URL` / `query parameter` / `path parameter` / `request header` / `request body` / `request content type` / `client address` | 既存 | 拡張が持つリクエストの情報 | `c.req.*` | ヘッダ名は小文字にそろえる | ○ |
| `request JSON`（`requestJson`） | P0 | 共有RT@ブラウザ | 共有RT | 解析できなければ 400 を返す | ◎ |
| `set HTTP status` / `set response header` / `remove response header` / `set response body` / `send response` | 既存 | 拡張 | IR が応答を組み立てる | `content-length` などランタイムが管理するヘッダは禁止 | ○ |
| `respond with text / HTML / JSON` | 既存 | 拡張 | `c.text` / `c.html` / `c.json` | なし | ○ |
| `redirect to [URL] [STATUS]`（`redirect`） | P0 | 拡張 | `c.redirect` | 外部への転送先は許可リストで制限する（オープンリダイレクト対策） | ○ |
| `set cookie [NAME] [VALUE] [OPTIONS]`（`setCookie`）/ `cookie [NAME]` | P0 | 拡張 | `hono/cookie` | 既定で `HttpOnly; Secure; SameSite=Lax` | ○ |
| `current request id` / `use HTTP request [ID]` | 既存 | — | — | **サーバ層では禁止する。** bridge モードでリクエストを1件ずつ処理するので不要になる | — |
| `send [TEXT] to HTTP bridge` / `connect` など接続系 | 既存 | — | — | 開発用なのでサーバ層では禁止する | — |

### 4.3 構造化データ（JSON）

値は JSON 文字列として表現する。Scratch の値の型（文字列、数値、真偽値）の中に収めるためである。

| ブロック | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `new object` / `new array` | P0 | 共有RT@ブラウザ | 共有RT | なし | ◎ |
| `JSON [OBJ] at [PATH]` / `set [PATH] of [OBJ] to [V]` / `delete [PATH] of [OBJ]` | P0 | 共有RT@ブラウザ | 共有RT | path は `a.b[0]` 形式 | ◎ |
| `length of JSON [V]` / `keys of [OBJ]` / `type of [V]` | P0 | 共有RT@ブラウザ | 共有RT | なし | ◎ |
| `append [V] to JSON array [ARR]` / `concat` / `slice` | P0 | 共有RT@ブラウザ | 共有RT | なし | ◎ |
| `JSON array [ARR] to list [LIST]` / `list [LIST] as JSON array` | P0 | VM と共有RT | IR と共有RT | Scratch のリストとの橋渡し。要素を1つずつ処理するには、これと `control_for_each` を組み合わせる | ○ |
| `parse JSON [TEXT]` / `JSON value [V] as text` | P0 | 共有RT@ブラウザ | 共有RT | 解析に失敗したら §4.5 のエラーにする | ◎ |

### 4.4 入力の検証

| ブロック | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `validate request JSON with schema [SCHEMA]`（`validateRequestJson`） | P0 | 共有RT@ブラウザ | 共有RT | 失敗したら自動で 400 を返し、スクリプトを終える。スキーマは JSON Schema のサブセット | ◎ |
| `[V] is [email/uuid/integer/url/iso-date]?` | P0 | 共有RT@ブラウザ | 共有RT | なし | ◎ |

### 4.5 エラー処理（結果を値として判定する方式）

| ブロック | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `last operation failed?` / `last error message` / `last error code` | P0 | 拡張がスレッドごとに状態を持つ | IR が呼び出しごとに状態を持つ | 失敗しうるブロック（DB、外部 HTTP、JSON の解析）が実行のたびに更新する | ○ |
| `fail with HTTP [STATUS] [MESSAGE]`（`failWith`） | P0 | 拡張が応答を確定し、スクリプトを止める | IR が応答を確定し、実行を終える | 応答は problem+json 形式 | ○ |
| （暗黙）処理されなかった失敗 | P0 | ランタイムが 500 を返す | ランタイムが 500 を返す | 詳しい内容はログにだけ出し、応答には含めない | ○ |

`試す…エラーなら` の C 型ブロックは採用しない。VM でスレッドのスタックを操作する必要があり、2つのモードで同じ意味にするのが難しいためである。

### 4.6 設定・秘密情報・時刻・ID・暗号

| ブロック | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `config [NAME]` | P0 | RPC（bridge サーバの `.dev.vars`） | `c.env` | 秘密情報ではない値に使う | ○ |
| `secret [NAME]` | P0 | **値は返さず、参照用のトークンを返す**。実際の値は bridge サーバが差し込む | 同じ（Workers の Secrets） | **決められた入力欄にしか置けない**（外部 HTTP の認証欄、HMAC と署名の鍵欄）。それ以外に置くと検査で拒否する | ○ |
| `current time (ISO)` / `current time (epoch ms)` | P1 | RPC（サーバの時計） | `Date.now()` | テスト時は固定した時計に差し替える | △ |
| `new UUID` / `secure random token [BYTES]` | P1 | RPC | `crypto.randomUUID` / `getRandomValues` | テスト時は決定的な値に差し替える | △ |
| `SHA-256 of [TEXT]` / `HMAC-SHA256 [SECRET] [TEXT]` / `verify HMAC signature …` | P1 | RPC（鍵がサーバ側にあるため） | WebCrypto | 比較は定数時間で行う | ○ |
| `base64 encode/decode` / `URL encode/decode` | P1 | 共有RT@ブラウザ | 共有RT | なし | ◎ |

### 4.7 （廃止）

旧「Realtime ツールの定義」（`when tool [NAME] called`、`tool argument`、`return tool result`）は廃止した。ツールは §4.8 の関数値を `export as tool` で公開して定義する。

### 4.8 関数値（JSON を受け取り JSON を返す名前つき関数）

#### 4.8.1 2層構成

関数は次の2層に分ける。

| 層 | 手段 | 用途 | 特徴 |
|---|---|---|---|
| 1. 通常の関数 | TurboWarp の独自ブロック（戻り値あり。§3.1） | 内部の処理、再帰 | 型つきの引数欄。同じスレッドで呼ばれるので速い。同期実行のみ |
| 2. **関数値** | この節の `define function` ハット | Realtime ツール、コールバック、ジョブのハンドラ、高階処理、並行処理 | 引数と戻り値は JSON と JSON Schema で表す。名前で参照し、直列化できる。同期実行と非同期実行を選べる |

内部のロジックは第1層で書き、関数値は**境界に置く部品**として使う。**Realtime API のツールは、関数値を `export as tool` で公開したもの**として定義する。ツール専用のハットは設けない。

#### 4.8.2 定義と公開

| ブロック（opcode 案） | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `define function [NAME] args schema [S] returns schema [R] description [D] export as [none/tool]`（ハット、`defineFunction`） | P0 | 抽出器が関数表に登録する。呼ばれたらハットを起動する | IR の関数表に登録する | 名前はプロジェクト全体で一意にし、`スプライト名/NAME` で修飾する。同じスプライトの中では修飾を省略できる | ○ |
| `function argument [PATH]` / `function arguments JSON` | P0 | 拡張が呼び出しごとに状態を持つ | IR | 関数値のハットの中でだけ使える | ◎ |
| `return [JSON]`（`returnValue`） | P0 | 拡張が呼び出し元の待ちを解き、スレッドを止める | IR が値を返す | 省略した場合は `null` を返す | ○ |

**`export as tool` を指定した関数値の扱い：**

- **ツールの定義の生成：** 抽出器が Realtime のセッション設定の `tools` を生成する。`name` は NAME から、`description` は D から、`parameters` は S から作る。bridge サーバと、配置先の Hono が client secret を発行するときにこの設定を使う。ツール名は OpenAI の制約に合わせる（英数字、`_`、`-`）。
- **呼び出しの経路：**
  - bridge モードでは、bridge サーバが持つ Realtime のサイドバンド WS で `function_call` を受け取り、関数値のハットを起動する。`return` の値を `function_call_output` として送る。
  - compiled モードでは、Durable Object のサイドバンド処理が IR の関数を呼び、その結果を送る。
- **検証：** ツールの引数は LLM が生成したものなので、§4.8.7 の規則どおり、必ず Schema で検証する。検証に失敗したら、エラーの内容を `function_call_output` として返し、モデルに引数を直させる。
- **ツール以外からの呼び出し：** `export as tool` を指定した関数値も、`call` / `start` で通常の関数値として呼べる。

#### 4.8.3 参照と呼び出し

| ブロック | 優先度 | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|---|
| `function [NAME]` → 関数への参照 | P1 | 共有RT@ブラウザ | 共有RT | 存在しない名前は検査でエラーにする | ◎ |
| `bind [REF] with [JSON]` → 関数への参照 | P1 | 共有RT@ブラウザ | 共有RT | 部分適用。束縛した値と呼び出し時の引数でキーが重なったらエラーにする | ◎ |
| **同期：** `call [REF] with [JSON]` → JSON | P1 | §4.8.5 | 関数表の名前で分岐して直接呼ぶ | 終わるまで呼び出し元は待つ | ○ |
| **非同期：** `start [REF] with [JSON]` → Promise への参照 | P1 | §4.8.5 | JS の Promise を作り、呼び出しの Promise 表に登録する | すぐに戻る。§4.8.6 の規則に従う | △（実行順は保証しない） |
| `await [PROMISE]` → JSON | P1 | 拡張が完了を待つ | `await` | 失敗した Promise を待つと、§4.5 の失敗になり `null` を返す | ○ |
| `await all [JSON array of PROMISE]` → JSON 配列 | P1 | 拡張が全部の完了を待つ | `Promise.allSettled` | 結果は元の順序で返す。失敗した要素は `{"$error": …}` になる | ○ |
| `[PROMISE] settled?` | P1 | 拡張 | Promise 表 | 待たずに確認するだけ | △ |
| `map` / `filter` / `find` / `reduce [INIT]` / `sort by` `JSON array [ARR] with [REF]` | P1 | ランタイムが要素ごとに同期で呼ぶ | ランタイムが直接呼ぶ | 要素数の上限を設ける | ○ |
| `map JSON array [ARR] with [REF] concurrently up to [N]` | P1 | ランタイムが `start` と `await all` を使う | 同じ | N は §4.8.6 の上限以下 | ○（結果の順序は保つ） |
| `enqueue job [REF] with [JSON]` | P2 | §6 のキュー | Queues | 関数への参照を直列化してキューに渡す。§6 の `enqueue job [NAME]` を置き換える | △ |

#### 4.8.4 参照の表現

関数への参照は、次の形の JSON 値である。

```json
{"$fn": "Orders/computeTotal", "bound": {"currency": "JPY"}}
```

- クロージャ（変数を取り込むこと）は提供しない。束縛できるのは JSON の値だけである。その代わり、関数への参照は**直列化できる**。DB、KV、キューに保存し、別の呼び出しや別の isolate で呼び出せる。
- `call` と `start` は、`bound` と呼び出し時の引数を浅くマージし、その結果を `args schema` で検証する。

Promise への参照は、次の形の JSON 値である。

```json
{"$promise": "p_3"}
```

- Promise への参照が有効なのは、**それを作った呼び出し（リクエスト1回、またはツールの呼び出し1回）の中だけ**である。保存しても意味を持たない。ほかの呼び出しの参照を `await` すると失敗する。

#### 4.8.5 bridge モードでの実現

TurboWarp のコンパイラでは、拡張ブロックから `startProcedure` を呼べない（`src/compiler/compat-block-utility.js` が例外を投げる）。そのため、関数値の呼び出しは**ハットを起動する方式**で実現する。

- **同期（`call`）：**
  1. `define function` のハットを `startHats` で起動する。引数は拡張が呼び出しごとに保持する。
  2. 呼び出し元のブロックは Promise を返して待つ。
  3. 呼ばれた関数の `return` が待ちを解く。処理されなかった失敗は、呼び出し元の失敗として伝える。
- **非同期（`start`）：**
  - ハットを起動し、すぐに Promise への参照を返す。関数のスレッドは、呼び出し元のスレッドと並行して VM のスケジューラで進む。
  - `await` のブロックは、拡張が持つ Promise 表を待つ。
- **同名の関数値は並行して実行できない：**
  - 拡張機能のハットは、既定（`restartExistingThreads: false`）では、同じスクリプトが実行中だと起動されない。`true` にすると、今度は実行中のスレッドを止めて起動し直す。
  - そのため bridge モードの拡張は、**同じ名前の関数値の実行を、その名前ごとの待ち行列で順番に処理する**。
  - 異なる名前の関数値どうしは並行して進む。
- **所要時間：** 同期でも非同期でも、1回の呼び出しごとに最低1フレーム待つ。TurboWarp の既定の30fpsでは約33ms、60fpsの設定では約17msかかる（§9 で実測を予定）。同名の関数値を100回 `start` すると、bridge モードでは逐次に処理されるので数秒かかる。compiled モードでは本当に並行して実行される。
- **再入の禁止：** 同期呼び出しで、自分自身を（間接的な場合も含めて）呼ぶと、待ち行列で自分を待つことになり、処理が止まる。そこでランタイムは呼び出しの連鎖を記録し、再入を検出したら「reentrant call」の失敗にする。2つのモードの意味をそろえるため、**compiled モードでも同じ条件で失敗にする**。参照先が定数の場合は、検査器が呼び出しの循環を静的に検出する。再帰は第1層（独自ブロック）で書く。

実行時に振り分け用のスクリプトをターゲットへ差し込む方式も考えられる。同期的に呼べるので速いが、VM の内部構造に依存するうえ、利用者のプロジェクトを書き換えることになるため採らない。

##### 4.8.5.1 bridge モードの速度と対策

**費用のモデル：** bridge モードでは、Promise を待つブロックは次のフレームまで再開できない。Promise の完了はマイクロタスクで伝わるため、VM がそのフレームの処理を終えるまで反映されないからである。この費用は関数値に限らず、**RPC を使う副作用ブロック（SQL、KV、外部 HTTP 通信、暗号など）すべて**にかかる。1回の待ちは、30fps で約33ms、60fps で約17ms、250fps で約4ms と見積もる（§9 で実測する）。

**見積もり（30fps）：**

| ケース | 待ちの回数 | bridge | compiled | 評価 |
|---|---|---|---|---|
| 一般的な CRUD のハンドラ（SQL 3〜5回） | 3〜5 | 約0.1〜0.2秒 | 数十ms | 問題なし |
| ツールの呼び出し（関数値2〜3個 × SQL 2回） | 約10 | 約0.3秒 | 数十ms | 問題なし |
| N+1 型：100件の各要素ごとに SQL や関数値を呼ぶ | 100以上 | 3秒以上 | 数十〜数百ms | 遅い |
| 外部 API への並行呼び出し：同じ関数値で50個の URL を取得（1件300ms） | 50、しかも逐次 | 約16秒 | 約0.3秒 | 許容できない |
| テスト一式：500ケース × 各10回の待ち | 5000 | 約3分 | 数秒 | 許容できない |

同じ名前の関数値を順に処理する制約が大きく効くのは、外部 API への並行呼び出しの場合である。このとき積み重なるのは、フレームの待ちではなく通信の遅延そのものであるため、差が桁違いに大きくなる。

**対策（効果の大きい順に採用する）：**

1. **まとめて実行するブロック（P1）。** 待ちの多い処理には、1回の RPC で bridge サーバがまとめて処理するブロックを用意する。フレームの待ちも、同名の関数値を順に処理する制約も避けられる。N+1 型ではなく、一括で扱う書き方を利用者に促す効果もあり、本番の性能にも効く。

   | ブロック | bridge | compiled | 制約 | 差分 |
   |---|---|---|---|---|
   | `HTTP requests [JSON array of {method, url, headers, body, auth}] concurrently up to [N]` → 結果の JSON 配列 | RPC 1回。bridge サーバが並行して取得する | `Promise.allSettled` と `fetch` | §5 の外部 HTTP 通信と同じ制約。N は §4.8.6 の上限以下 | △（録画した応答で置き換える） |
   | `SQL query [SQL] for each of [PARAMS JSON array]` → 結果の JSON 配列の配列 | RPC 1回 | D1 の `batch()` | §5 の SQL と同じ制約 | ○ |
   | `KV get many [KEYS JSON array]` | RPC 1回 | 並行して `get` | なし | △ |

2. **テストは headless 実行でフレームを待たない。** テスト用のハーネスが TurboWarp VM をブラウザを使わずに動かし、`runtime` の `step` を自分で呼ぶ。Promise が完了したら、実時間を待たずにすぐ次のステップへ進める。差分テストの正解（オラクル）は、この実行で得る。Whisker が VM を制御する方式と同じ考え方である。ただし Whisker と違い、**時間の意味論には手を加えない**（サーバ層は時間依存ブロックを除外しているので必要がない）。
3. **開発中はフレームレートを上げることを推奨する。** 開発手順書で、TurboWarp の詳細設定でフレームレートを上げる（例：250fps）ことを推奨する。bridge サーバへの接続時に、拡張がフレームレートが低いことを検出したら、編集画面に警告を出す。
4. **関数値ごとに、開発中もサーバで実行できるようにする（P2）。** `define function` に field `dev execution [vm/server]` を設ける。`server` を指定した関数値は、bridge モードでも VM を通さず、bridge サーバの IR インタプリタで実行する。デバッガの「ステップオーバー」にあたる。
   - この関数値は開発中もブロックを1つずつ追えなくなるので、差分テストを通った関数値だけに指定できるようにする。
   - 2つのモードを混ぜて実行することになるが、関数値の境界は JSON で、Schema による検証もあるので、意味は変わらない。

これらで足りない場合の最後の手段として、クローンを使って同じ関数値を並行して実行する方式と、振り分け用スクリプトを差し込む方式を再検討する。

#### 4.8.6 非同期実行の規則

1. **寿命：** `start` した Promise は、それを作った呼び出し（リクエストまたはツールの呼び出し）が終わるまでに `await` しなければならない。
   - 終わる時点で待たれていない Promise があれば、ランタイムはそれを取り消し、警告のログを出す。bridge モードではスレッドを止め、compiled モードでは結果を捨てる。
   - 応答を返した後も処理を続けたい場合は、§6 の `after response do` か `enqueue job` を使う。
2. **同時に実行できる数の上限：** 1回の呼び出しの中で、同時に完了待ちにできる Promise の数に上限（既定8）を設ける。上限を超えて `start` すると、空きが出るまで待つ。
   - 目的は、Workers の外部リクエスト数や同時接続数の制限（数値は要確認）を守ることと、外部 API の負荷を抑えることである。
3. **状態の共有を禁止する：** 並行して実行される関数値のスレッドは、スプライト変数を共有している。そのため、`start` で呼ばれうる関数値の中でスプライト変数に書き込むことは、警告ではなく**エラー**にする（§8）。
4. **副作用の順序は保証しない：** 並行して実行される関数値が DB などに書き込む順序は、モードによっても実行ごとにも異なりうる。
   - 差分テストでは、`await` / `await all` が返す値（結果の集合と、配列の順序）だけを比べる。副作用の順序は比べない。
   - 順序が必要な処理は、`call` で逐次に書く。
5. **失敗の伝わり方：** `start` した関数値の失敗は、`await` した時点で初めて呼び出し元に伝わる。待たれずに取り消された Promise の失敗は、ログにだけ出る。

#### 4.8.7 検証とセキュリティ

- **引数は常に検証する。** 関数への参照は JSON なので、リクエストや DB から来た値が `call` / `start` に渡ることがありうる。そのため、関数値はすべて**公開された入口**（ツールや HTTP の route）と同じように扱い、引数は `args schema` で必ず検証する。
- **戻り値の検証は開発時とテスト時だけ行う。** bridge モードでは常に、compiled モードでは環境変数 `STRICT_CONTRACTS` が有効なときに検証する。ツールとして公開した関数値の戻り値は、常に検証する。
- **検証器は `eval` を使わない、解釈実行型のものを共有ランタイムに1つだけ置く。** Workers では Ajv の事前コンパイル型の検証器が使えないためである。
- **認可は関数の中で行う。** 関数値は呼び出し元の認証情報（current user）を引き継いで実行する。これは `start` の場合も同じである。権限が必要な処理を行う関数は、自分で `require role` などを確認する。呼び出し元が確認済みであることを前提にしない。
  - ツールとして呼ばれた場合、current user は、Realtime のセッションを開始した利用者になる。
- **キューに入れたジョブ**は、投入した時点の利用者の ID だけを引き継ぐ。セッションは引き継がない。

## 5. 拡張ブロック：永続化と利用者の識別（P1）

| ブロック | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|
| `SQL query [SQL] with [PARAMS JSON]` → 行の JSON 配列 | RPC（SQLite：libsql / better-sqlite3） | Adapter（D1 / Node では SQLite） | 方言は SQLite。**`[SQL]` の入力欄は定数の文字列だけ**にし、`join` などの組み立てを置くと拒否する（SQL インジェクション対策） | ○（同じ SQLite の意味論） |
| `SQL execute [SQL] with [PARAMS]` → 変更件数と最後の ID | 同上 | 同上 | 同上 | ○ |
| `run SQL batch [JSON array of {sql, params}] atomically` | RPC（`BEGIN … COMMIT`） | D1 の `batch()` | **途中に判断を挟めない**トランザクション。途中で判断が必要な処理は P2 の Durable Objects の SQLite に限る（D1 の仕様は実装前に確認） | ○ |
| `migration [VERSION]`（ハット、中身は SQL execute だけ） | bridge サーバの起動時に適用する | 抽出器が `migrations/*.sql` を生成し、wrangler で適用する | 番号順に実行し、一度適用したら変更しない | — |
| `save [JSON] in collection [C]` / `find in [C] where [FILTER]` / `update/delete [C] id [ID]` | RPC | Adapter（SQL の上に作るレコードストア） | `owner_id` を自動で付け、所有者で絞り込むことを既定にする | ○ |
| `KV get/put [KEY] [VALUE] ttl [SEC]` / `KV delete` | RPC（メモリまたは SQLite） | Adapter（Workers KV） | 結果整合性であることを説明に明記する。カウンタ用途には使わない | △（反映の遅れは再現しない） |
| `session [KEY]` / `set session [KEY] to [V]` / `regenerate session` / `destroy session` | RPC | Adapter（署名つき Cookie と KV / D1） | ログイン直後に `regenerate` を呼ぶことを推奨する（lint で警告） | ○ |
| `CSRF token` / `verify CSRF` | RPC | 同上 | Cookie セッションを使うフォームの POST では検証を必須にする（lint） | ○ |
| `current user id / email / provider` / `require login` | 既存と RPC | OAuth / OIDC のミドルウェア（既存の cloudflare IR） | 認証は外部の IdP に任せる | ○（偽の IdP を使う） |
| `user has role [R]?` / `require role [R]` / `is owner of [RECORD]?` | RPC | Adapter | 役割の情報は D1 に置く | ○ |
| `HTTP [METHOD] [URL] headers [H] body [B] auth [SECRET]` → 状態、ヘッダ、本文 | RPC（bridge サーバから通信する。CORS の制約を受けない） | `fetch` | 通信先は許可リストで制限する。タイムアウトを必須にする。秘密情報は参照でしか渡せない | △（録画した応答で置き換える） |
| `assert [A] equals [B]` / `send test request [METHOD] [PATH] [BODY]` | VM | IR | テストのハットの中でだけ使える | — |

## 6. 拡張ブロック：運用と規模（P2）

| ブロック | bridge | compiled | 制約 | 差分 |
|---|---|---|---|---|
| `uploaded file [FIELD]` → ハンドル / `store file [HANDLE] as [KEY]` / `signed URL [KEY]` | RPC（ファイルの中身は bridge サーバに置いたまま） | R2 | **バイナリは VM に渡さない** | ○（メタデータのみ） |
| `every [CRON]`（ハット） | bridge サーバのタイマーで起動する | Cron Triggers | 開いているタブでだけ動く、と明記する | △ |
| `enqueue job [NAME] [JSON]` / `when job [NAME] received`（ハット） | RPC（メモリ上のキュー） | Queues | 少なくとも1回は実行される前提なので、冪等に書くことを推奨する | △ |
| `after response do …`（C 型） | 応答の後に続けて実行する | `executionCtx.waitUntil` | 中身は副作用のブロックだけ | ○ |
| `when WebSocket message in room [R]`（ハット）/ `send to room [R] [JSON]` / `room state [KEY]` | RPC（メモリ上の部屋） | Durable Objects | 部屋ごとに1つのアクターとして動く。部屋の状態は `room state` を通してだけ扱う | △ |
| `rate limit [N] per minute by [KEY]` | RPC（メモリ） | Durable Objects または Rate Limiting | 上限を超えたら自動で 429 を返す | ○ |
| `log [LEVEL] [JSON]` / `request id` | 既存（`recordHttpLog`）と RPC | `console` と構造化ログ | 秘密情報の参照トークンはログで伏せ字にする | — |
| `send email …` / `call LLM …` | RPC | プロバイダの API | 秘密情報は参照で渡す | △ |
| `new HTML element` / `markdown …` / `render HTML` | 既存（拡張の中で実行） | 共有RT（既存実装を移す） | 既定でエスケープする | ◎ |

## 7. 第三者の拡張機能を許可リストに加える条件

次の3つを満たす拡張機能だけを、サーバ層で使えるようにする。

1. ブロックごとに、純関数か副作用ありかを宣言している（`extension-manifest.json` に記載）。
2. 純関数ブロックを共有ランタイムとして、副作用ブロックを Adapter インタフェースとして、npm パッケージで提供している。
3. 同じテストを2つのモードで流し、通過している。

## 8. 検査器（抽出時）の規則まとめ

1. サーバ層のハットの下で、§3.1、§4〜§6、§7 の許可リストにない opcode を使っていたらエラーにする。エラーにはスプライト名とブロック ID を含める。
2. サーバ層のスクリプトと、そこから呼ばれる独自ブロックで「画面を再描画せずに実行」が有効でなければエラーにする。
3. ステージ変数に書き込んでいたらエラーにする。独自ブロックの中でスプライト変数に書き込んでいたら警告する。
4. `secret` を決められた入力欄以外に置いていたらエラーにする。
5. SQL の入力欄に定数以外が置かれていたらエラーにする。
6. 同じ route や同じツール名が重複していたらエラーにする。
7. `control_stop` で `all` か `other scripts` を指定していたらエラーにする。
8. `function [NAME]` と `$fn` の定数が、存在しない関数値を指していたらエラーにする。参照先が定数の `call` で呼び出しが循環していたらエラーにする（§4.8.5）。
9. `define function` の `args schema` と `returns schema` が JSON Schema のサブセットとして正しくなければエラーにする。関数値のハットの中でスプライト変数に書き込んでいたら警告する。`start` で呼ばれうる関数値の中での書き込みはエラーにする（§4.8.6）。
10. `export as tool` を指定した関数値で、`description` が空、またはツール名が OpenAI の命名規則に合わない場合はエラーにする。

検査器は TypeScript で1つだけ実装し、次の3か所で使う。

- 抽出の CLI
- bridge サーバ（リクエストを受け付ける前の検査）
- TurboWarp 拡張（編集中の警告表示）

## 9. 未確定事項

- D1 が対話的なトランザクションに対応しているかを、公式ドキュメントで確認する（§5）。
- 本家 Scratch 形式との互換性。戻り値つき独自ブロックは TurboWarp 専用の形式になる。
- `control_for_each` は TurboWarp で非表示のブロックである。代わりに JSON 配列を反復する専用の C 型ブロックを用意するか決める。
- 深さの上限と実行量の上限の既定値を、Workers の CPU 時間制限から見積もる。
- bridge モードで1件ずつ処理するときの、待ち行列の上限とタイムアウト。
- §4.8.5.1 の費用のモデルを実測で確認する。
  - Promise を待つブロック1回あたりの遅延：30 / 60 / 250fps のそれぞれで、RPC を使う副作用ブロックと、関数値の `call` を測る。
  - `startHats` で起動した関数値のスレッドが、呼び出し元と同じフレームの中で始まるか。
- headless のテスト用ハーネスで、`step` を自分で呼んだときに、Promise が完了してから次のステップまでの遅延がほぼなくなるか。TurboWarp VM を Node で動かせるかの確認も含める（層3の PoC と共通）。
- TurboWarp で設定できるフレームレートの上限と、拡張から現在のフレームレートを取得する方法（低フレームレートの警告に使う）。
- JSON Schema のどのサブセットを使うかと、`eval` を使わない検証器の選定。
- Workers の外部リクエスト数と同時接続数の制限を確認し、§4.8.6 の同時実行数の上限（既定8）が妥当かを決める。
- bridge モードでの開発時の体感速度が、§4.8.5.1 の対策1〜3で許容できる範囲に収まるかを、参照アプリ（ログイン付き ToDo API、Webhook の受け口、Realtime エージェントのツール）で確認する。収まらなければ、対策4を P1 に繰り上げるか、クローンを使った並行実行か、振り分け用スクリプトの差し込みを再検討する。
- `dev execution: server` を指定できる条件（「差分テストを通った関数値」）を、どう判定して記録するか。
