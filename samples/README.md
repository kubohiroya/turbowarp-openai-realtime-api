# relay-text-reply

1. Editorで開き、**Run without sandbox**を選択して拡張を許可します。緑旗はローカル状態の初期化だけです。
2. localhost relayでproviderを設定して起動し、**Configure**をクリック。ループバックorigin、8桁の一回限りのコードを入力します。API keyは入力しません。最後の確認では空欄のままEnterを押し、入力したコードを消します。
3. **Relay paired = true**を確認して**Start**をクリック。マイクはoffで、応答はテキストのみ。1応答で切断し、音声は再生しません。
4. **Stop / Clear**で終了し設定・結果を消去。保存・共有前に空欄回答とClearを実行してください。元のサンプルを開き直すと入力は空に戻ります。

## 要件

localhost capability-proxy（openai provider、課金有効なOpenAI APIアカウント、許可済みモデル）、WebRTC対応ブラウザ。API keyはrelayだけに設定。テキスト応答、マイクoff、音声出力off。

## 未検証

実relayペアリング、API課金通信、WebRTC接続と実モデル応答は未検証。
自動検証ではrelay接続・マイク取得・発話・機器操作を開始しません。成功結果を事前保存しません。relay内のAPI key/tokenはこのファイルに入れません。

## 再生成

`relay-text-reply/project.json` とSVGを編集し、Node.js 26で `node scripts/build-samples.mjs`、`node scripts/build-samples.mjs --check`、`node --test scripts/verify-samples.mjs`。SB3は固定時刻のZIP、distの確認済みJSを同梱します。`node scripts/prepare-pages.mjs` が既存siteとdist/SB3を `_site/` に複製します。本体やフラグ既定値は変更しません。
