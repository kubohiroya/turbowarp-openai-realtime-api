# 関連研究（草稿）

本研究は、Scratch 3（TurboWarp）のプロジェクトファイル（.sb3）から、特定のハットブロック（HTTPリクエストの受信、LLMツールの呼び出し等）以下に許可ブロックのみで記述されたスクリプトを抽出し、中間表現（IR）に変換してサーバ（Hono / Cloudflare Workers, Node.js）上で実行する。同一のスクリプトは、開発時にはブラウザ上のScratch VMでWebSocketブリッジ経由で実行できる。本章では、(1) ブロック型言語とネットワーク／サーバ、(2) 利用者コードのサーバ側実行、(3) multitierプログラミング、(4) ブロック型プログラムの変換と静的検査、(5) Scratchプログラムの実行制御とテスト、の順に関連研究を整理し、最後に本研究の位置づけを述べる。

## 1. ブロック型言語とネットワーク／サーバ

**NetsBlox.** Brollらは、Snap!を拡張し、メッセージパッシングと遠隔手続き呼出し（RPC）によって分散プログラミングを教えるNetsBloxを提案した[1, 2]。利用者のブロックプログラムはブラウザ上で実行され、サーバはRoom/Roleの登録に基づくメッセージのルーティングと、RPCの実行を担う。RPCは地図や天気等の第三者APIをブロック呼出しに写像するものであり、2017–2018年の時点では「固定されたRPCの集合」のみが提供され、利用者定義のRPCは開発中とされていた[2]。その後の報告[3]では、(a) クライアントから渡されたブロック関数をサーバ上でJavaScriptに変換して一度だけ評価するExecuteサービス、(b) 表データから利用者が作成し、RPCの処理をNetsBloxスクリプトで与えられるコミュニティサービス、(c) ブロックで記述したAlexaのインテント処理をサーバでJavaScriptに変換して実行する機能、が導入されている。すなわちNetsBloxには、ブロックコードをサーバで実行する機構が限定的な形で存在する。ただしいずれもNetsBloxのランタイムとRPC呼出しの枠組みの内部に閉じており、汎用のHTTPルートやLLMツールのハンドラをブロックで記述し、独立したサーバへ配置するものではない。

**ドリトル.** 兼宗らの教育用言語ドリトルは、教室LAN上に「オブジェクトバンク」と呼ぶサーバを置き、直列化したオブジェクトを文字列キーで格納・取得・共有する機能を持つ[4, 5]。中学校技術科での通信プログラムの実践[6]では、生徒がサーバに文字列を登録し、他の生徒がそれを取得する形で通信を学んでいる。ここでのサーバは受動的なオブジェクト格納庫であり、利用者のコードはすべてクライアント側で実行される。

**クラウドのデータやサービスの利用.** このほか、ScratchからWeb API経由でコミュニティのデータを取得するScratch Community Blocks[7]や、App Inventorから共有データを読み書きするCloudDB[8]がある。これらを含め、既存研究の多くでは、ブロック型言語はサービスを**利用する側**の記述に用いられ、サービスを**提供する側**はテキスト言語で実装されている。

## 2. 利用者コードのサーバ側実行

**Bit Arrow.** 兼宗研究室のオンライン学習環境Bit Arrowは、通常は各言語をJavaScriptに変換してブラウザで実行するが、Python処理系ではブラウザ実行とサーバ実行を利用者が選択できる[9]。許可していない関数やライブラリの呼出しはコンパイルエラーとし、同じ検査器をブラウザとサーバ（node.js）の双方で実行することで、改ざんされた要求にも対処している。さらに、生徒が書いたPythonプログラムにURLを割り当て、GETパラメータを`input()`で受け取り`print()`で応答を返すクライアントサーバアプリのグループ開発授業も報告されている[10]。利用者コードをHTTPから呼ばれるサーバ処理とし、許可リストによる事前検査と、ブラウザ／サーバ双方での検査を行う点で、本研究に最も近い先行事例である。一方、対象はテキストのPythonであり、要求ごとにCPythonのプロセスを起動し、要求と応答は標準入出力に写像される。本研究はScratch 3のブロックを対象とし、opcodeの許可リストで検査したうえで独自のIRとしてHonoサーバ内で解釈実行し、HTTPハンドラとLLMツールハンドラという明示的な意味論を与える点で異なる。

**非研究の実践例.** 研究論文ではないが、Blocklyで記述した処理を編集時にJavaScriptへ変換し、Node-REDのサーバ上で実行するnode-red-contrib-blockly[11]や、Blocklyで記述したAPIサービスの各操作にエンドポイントを割り当てるBackendless Codeless[12]がある。いずれも独自のブロックセットとプラットフォームに依存し、汎用のブロック型言語で書かれた既存のプロジェクトを入力とするものではない。

## 3. multitier（tierless）プログラミング

Weisenburgerらは、クライアントやサーバといった異なる層（tier）の処理を同じコンパイル単位に記述し、実行時の生成またはコンパイラによる分割で各層のコードを得るmultitierプログラミングの言語29種を調査した[13]。配置の指定方法は、専用の層割当て、注釈、エスケープ／引用、型、静的解析、実行時検査に分類され、分割の粒度はファイルから部分式にまで及ぶ。分割後のプログラムと元のプログラムの振る舞いの等価性は、一部の言語で形式的に証明されているにとどまる。例えば、弱双模倣によって示したもの、Eliomにおける単一ページ生成についての模倣関係などである。テストによって検証する取り組みや実証的な研究は報告されていない。また調査対象はすべてテキスト言語であり、ビジュアル言語やブロック型言語、エンドユーザ向け言語は含まれていない。サーバレス環境も論じられていない。

本研究は、1つの.sb3プロジェクトをハットブロックの種類を目印（専用の層割当て）としてサーバ層とクライアント層に分割するものと捉えられ、ブロック型言語によるmultitierプログラミングの一形態と位置づけられる。分割の粒度はスクリプト単位である。ただしmultitier言語の多くが分割後の単一の実行形態を前提とするのに対し、本研究では同一のサーバ層スクリプトが「ブリッジ経由のブラウザ実行」と「サーバ実行」の2つの実行形態を持ち、その等価性を差分テストで検証する点に特徴がある。

## 4. ブロック型プログラムの変換と静的検査

**LitterBox.** Fraserらによる、Scratchプログラムの静的解析器である[14]。project.jsonを、ブロックの種類ごとに異なるクラスを持つASTへ変換し、Visitorパターンによるバグパターン・コードスメルの検出と、制御フローグラフによる解析を行う。7万件超の公開プロジェクトへの適用で10万件超の問題を検出している。Scratchの型の緩さは型を持たないラッパクラスで表現され、並行性やイベントはパターンとしてのみ扱われる。実行意味論のモデルは持たない。解析器の現行実装では未知のopcodeを「Unspecified」ノードとして許容する。これに対し本研究の抽出器は許可リスト外のopcodeを拒否する。本研究の抽出・検査段階はLitterBoxのAST設計を参照しうるが、目的は解析ではなく実行である。後継のLitterBox+[15]はLLMとの連携のためにscratchblocksテキストとの相互変換を備える。

**ブロックとテキストの相互変換.** 松澤らのBlockEditorは、OpenBlocksを基盤にブロックとJavaの相互変換を実現し、初学者が両者を「交ぜ書き」しながらJavaへ移行する過程を108名の授業で分析した[16]。Microsoft MakeCodeはブロックとStatic TypeScript（TypeScriptのサブセット）を相互変換し、マイコン向けにコンパイルする[17]。Leopardは.sb3を人間が読めるJavaScriptへ一対一に近い形で変換する[18]。いずれもブロックからテキストへの移行や別環境での実行を目的とし、変換対象はプログラム全体である。本研究はテキストへの移行を目的とせず、ブロックを記述言語として保ったまま、サーバ層に属するスクリプトだけを選択的に変換する。

**不正なプログラムの排除.** 松本・浅井のOCaml Blocklyは、ブロックの接続子に型を持たせ、接続時の単一化に失敗すると接続を拒否することで、構文エラー・型エラー・未束縛変数エラーを編集時に排除する[19]。本研究は、Scratch 3の既存ブロックセットを変更せずに用いるため、編集時の拒否ではなく、抽出後の許可リスト検査によって実行可能なサブセットを保証する。編集時の支援（許可外ブロックの警告表示等）は今後の課題である。

## 5. Scratchプログラムの実行制御とテスト

Whiskerは、scratch-vmをラップして入力イベントを送り、各スケジューリングステップ後の状態に対して性質を検査するScratchプログラムの自動テスト基盤である[20, 21]。Deinerらは、テストの高速化と決定性のために、実時間をステップ数に置き換える、timerを1ステップあたり一定値だけ進める、乱数を固定シードにする等、VMの意味論に手を加えた。これにより非決定性を除去しつつ、元のVMとの間に「わずかな」挙動差が生じうることを認めている[21]。

本研究の差分テストは、ブリッジ経由のScratch VMを正解（オラクル）とし、サーバ実行の結果と比較する。Scratchの形式意味論は確立しておらず、実質的な意味の基準はscratch-vmの実装である。そのためVMとの比較は妥当な検証手段である。ただしWhiskerの知見が示すとおり、時間や並行性に依存するブロックはVM側でも決定的に再現しにくい。本研究がサーバ層のサブセットから`wait`等の時間依存ブロックを除外し、1回の呼出しで完結する意味論を採るのは、差分テストの前提となる決定性を確保するためでもある。

## 6. 本研究の位置づけ

| | 記述言語 | 利用者コードの実行場所 | サーバ処理をブロックで記述 | 汎用HTTP/ツールハンドラ | 検査 | 実行形態の等価性検証 |
|---|---|---|---|---|---|---|
| NetsBlox [1–3] | Snap! | ブラウザ（一部サーバ） | 限定的（Execute、コミュニティ、Alexa） | × | 埋め込みJS禁止、時間制限 | — |
| ドリトル [4–6] | テキスト | クライアント | × | × | — | — |
| Bit Arrow [9, 10] | テキスト（Python） | ブラウザ／サーバ選択 | ×（テキスト） | 標準入出力への写像 | 許可リスト（双方で検査） | — |
| multitier言語 [13] | テキスト | 層ごとに分割 | × | ○（言語による） | 型・注釈等 | 一部で形式的証明 |
| LitterBox [14] | Scratch 3 | （実行しない） | — | — | バグパターン | — |
| Whisker [20, 21] | Scratch 3 | ブラウザ（VM） | — | — | 性質検査 | — |
| **本研究** | **Scratch 3（サブセット）** | **ブラウザ（開発）／Hono（配置）** | **○** | **○** | **opcode許可リスト** | **差分テスト** |

以上をまとめると、本研究の新規性は次の3点にある。

1. 汎用のブロック型言語で既存プロジェクト（.sb3）を入力とし、サービスを**提供する側**の処理を記述する。
2. 同一スクリプトにブリッジ実行とサーバ実行の2つの実行形態を与える、ブロック型言語によるmultitierプログラミングである。
3. 2つの実行形態の等価性を差分テストで検証する。

また応用として、音声AIエージェント（OpenAI Realtime API）のツール実装を示す。

## 参考文献

[1] B. Broll, Á. Lédeczi, P. Völgyesi, J. Sallai, M. Maróti, A. Carrillo, S. L. Weeden-Wright, C. Vanags, J. D. Swartz, M. Lu. A Visual Programming Environment for Learning Distributed Programming. SIGCSE 2017, pp. 81–86. doi:10.1145/3017680.3017741

[2] B. Broll, Á. Lédeczi, H. Zare, D. Nguyen Do, J. Sallai, P. Völgyesi, M. Maróti, L. Brown, C. Vanags. A visual programming environment for introducing distributed computing to secondary education. Journal of Parallel and Distributed Computing, 118:189–200, 2018. doi:10.1016/j.jpdc.2018.02.021

[3] C. Brady, B. Broll, G. Stein, D. Jean, S. Grover, V. Cateté, T. Barnes, Á. Lédeczi. Block-based abstractions and expansive services to make advanced computing concepts accessible to novices. Journal of Computer Languages, 73:101156, 2022.

[4] 兼宗進, 中谷多哉子, 御手洗理英, 福井眞吾, 久野靖. オブジェクト指向言語「ドリトル」を利用した情報教育について. 情報教育シンポジウム SSS2001, pp. 275–282, 2001.

[5] 兼宗進, 久野靖. プロトタイプ階層を持つ教育用オブジェクト指向言語「ドリトル」. コンピュータソフトウェア, 28(1):43–48, 2011.

[6] 西ヶ谷浩史, 兼宗進, 紅林秀治. 中学校技術科におけるドリトルを利用した通信プログラムの実践. 情報処理学会研究報告, 2016-CE-134(18), 2016.

[7] S. Dasgupta, B. M. Hill. Scratch Community Blocks: Supporting Children as Data Scientists. CHI 2017. arXiv:1702.00112

[8] N. Lao. CloudDB: Components for exploring shared data with MIT App Inventor. IEEE Blocks and Beyond Workshop, 2017.

[9] 長慎也, 長島和平, 間辺広樹, 兼宗進, 並木美太郎. オンラインプログラミング環境Bit ArrowにおけるPython処理系. 情報教育シンポジウム SSS2019, pp. 122–126, 2019.

[10] 伊藤匡祐, 田中友士, 東汰樹, 漆原宏丞, 本多佑希, 兼宗進. Bit Arrowを利用したクライアントサーバーアプリのグループ開発授業. 情報処理学会研究報告, 2024-CE-173(5), 2024.

[11] B. Butenaers. node-red-contrib-blockly. https://github.com/bartbutenaers/node-red-contrib-blockly

[12] Backendless. Codeless Development Guide: API Services. https://backendless.com/docs/codeless/

[13] P. Weisenburger, J. Wirth, G. Salvaneschi. A Survey of Multitier Programming. ACM Computing Surveys, 53(4):81, 2020. doi:10.1145/3397495

[14] G. Fraser, U. Heuer, N. Körber, F. Obermüller, E. Wasmeier. LitterBox: A Linter for Scratch Programs. ICSE-SEET 2021, pp. 183–188. doi:10.1109/ICSE-SEET52601.2021.00028

[15] B. Fein, F. Obermüller, G. Fraser. LitterBox+: An Extensible Framework for LLM-enhanced Scratch Static Code Analysis. ASE 2025 (Tool Demonstrations). doi:10.1109/ASE63991.2025.00357

[16] 松澤芳昭, 保井元, 杉浦学, 酒井三四郎. ビジュアル-Java相互変換によるシームレスな言語移行を指向したプログラミング学習環境の提案と評価. 情報処理学会論文誌, 55(1):57–71, 2014.

[17] T. Ball ほか. Static TypeScript: An Implementation of a Static Compiler for the TypeScript Language. MPLR 2019.（著者一覧は要確認）

[18] Leopard. https://github.com/leopard-js/leopard

[19] 松本晴香, 浅井健一. Blocklyをベースにした OCaml ビジュアルプログラミングエディタ. 第21回プログラミングおよびプログラミング言語ワークショップ（PPL2019）, 2019.

[20] A. Stahlbauer, M. Kreis, G. Fraser. Testing Scratch Programs Automatically. ESEC/FSE 2019, pp. 165–175. doi:10.1145/3338906.3338910

[21] A. Deiner, P. Feldmeier, G. Fraser, S. Schweikl, W. Wang. Automated Test Generation for Scratch Programs. Empirical Software Engineering, 28(3):79, 2023. doi:10.1007/s10664-022-10255-x

---

### 執筆メモ（投稿前に削除）

- **本文を読んで確認した文献：** [1][2][3][4][5][6][9][10][13][14][15][16][19][21]
- **確認が不完全な文献：**
  - [20]：本文を入手できず、SE2020の2ページ要旨と[21]による記述のみで書いた。
  - [7][8][17][18]：要旨・Webページのみで確認した。
  - [17]：著者一覧が未確認（要修正）。
  - [7]：会議名が未確認。
  - [19]：PDFに会議名・年の印字がない。PPL2019の論文賞受賞ページで確認すること。
- **原文との照合が必要な箇所：** [4]はスキャン画像から読んだため、引用する語句は原文PDFと照合すること。
- **[3]の扱い：** 「NetsBloxではブロックは利用する側のみ」とは書かないこと。Execute、コミュニティサービス、Alexaの3機能により、サーバでのブロック実行が限定的に存在する。
- **追加調査の候補：** VL/HCC、Blocks and Beyond、SIGCSE、Koli Calling の予稿集。情報処理学会のコンピュータと教育研究会（CE）、情報教育シンポジウム（SSS）。
