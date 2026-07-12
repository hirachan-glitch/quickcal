# -*- coding: utf-8 -*-
"""A5判・印刷用PDFのための組版HTMLを生成し、ChromiumでPDF化する。"""
import html
from games_data import GAMES
from build_book import qr_svg, esc, short_url, CAT_META, price_class

OUT_HTML = "benricho-game-a5.html"
OUT_PDF = "benricho-game-a5.pdf"


def qr_block(g: dict) -> str:
    """A5用：ページ下部に横並びで置くQRブロック。"""
    kind = g["qr"][0]
    if kind == "site":
        url = g["qr"][1]
        return f"""
      <div class="qr-area">
        <div class="qr-side">
          <div class="qr-title">このゲームをはじめる</div>
          <p class="qr-hint">スマホのカメラを右のQRコードにかざして、画面に出る黄色いお知らせ（リンク）をタッチすると、公式ページが開きます。</p>
          <div class="qr-url">{esc(short_url(url))}</div>
        </div>
        <div class="qr-one">
          {qr_svg(url)}
        </div>
      </div>"""
    _, ios, android = g["qr"]
    return f"""
      <div class="qr-area">
        <div class="qr-side">
          <div class="qr-title">このゲームをはじめる</div>
          <p class="qr-hint">お使いのスマホに合うほうのQRコードに、カメラをかざしてください。</p>
        </div>
        <div class="qr-one">
          <div class="qr-device">iPhone の方</div>
          {qr_svg(ios, "qr qr-s")}
          <div class="qr-url">App Store</div>
        </div>
        <div class="qr-one">
          <div class="qr-device">Android の方</div>
          {qr_svg(android, "qr qr-s")}
          <div class="qr-url">Google Play</div>
        </div>
      </div>"""


def game_page(idx: int, g: dict) -> str:
    m = CAT_META[g["cat"]]
    steps = "\n".join(
        f'<li><span class="stepnum">{i + 1}</span><span class="steptext">{esc(s)}</span></li>'
        for i, s in enumerate(g["steps"])
    )
    caution = ""
    if g.get("caution"):
        strong = "お金" in g["caution"] or "NFT" in g["caution"]
        title = "⚠ お金にかかわる大切な注意" if strong else "ご注意"
        caution = f"""
      <div class="caution{' caution-strong' if strong else ''}">
        <span class="caution-title">{title}：</span>{esc(g["caution"])}
      </div>"""
    return f"""
  <section class="page game" style="--c:{m['color']};--bg:{m['bg']}">
    <header class="game-head">
      <div class="game-cat">{m['icon']} 第{m['no']}章　{esc(g['cat'])}</div>
      <div class="game-no">{idx:02d}<span>/30</span></div>
    </header>
    <h2 class="game-name">{esc(g['name'])}</h2>
    <div class="game-kana">{esc(g['kana'])}</div>
    <div class="{price_class(g['price'])}">料金：{esc(g['price'])}</div>
    <h3>どんなゲーム？</h3>
    <p>{esc(g['what'])}</p>
    <h3>あそびかた</h3>
    <ol class="steps">
{steps}
    </ol>
    <div class="osusume"><span class="osusume-title">😊 ここがおすすめ：</span>{esc(g['point'])}</div>{caution}
    {qr_block(g)}
  </section>"""


def toc(chapters) -> str:
    """指定した章番号のもくじ行を返す。ゲームNNは本文の (NN + 4) ページ目。"""
    rows = []
    cur = None
    for i, g in enumerate(GAMES, 1):
        m = CAT_META[g["cat"]]
        if m["no"] not in chapters:
            continue
        if g["cat"] != cur:
            cur = g["cat"]
            rows.append(
                f'<div class="toc-cat" style="--c:{m["color"]};--bg:{m["bg"]}">'
                f'{m["icon"]} 第{m["no"]}章　{esc(cur)}</div>'
            )
        rows.append(
            f'<div class="toc-row"><span class="toc-no">{i:02d}</span>'
            f'<span class="toc-name">{esc(g["name"])}</span>'
            f'<span class="toc-page">{i + 4}ページ</span></div>'
        )
    return "\n".join(rows)


COVER = """
  <section class="page cover">
    <div class="series">QR便利帳シリーズ</div>
    <h1>スマホの便利帳</h1>
    <div class="vol">ゲーム編</div>
    <div class="emoji">🎮🧩🐈🎴</div>
    <p class="lead">スマホで遊べる有名ゲーム 30選<br>QRコードをかざすだけで、すぐはじめられます</p>
    <div class="pub">ひらちゃんのAI＆デジタル生活サポート<br>2026年7月 発行</div>
  </section>"""

HOWTO = """
  <section class="page howto">
    <h2 class="sec">この本の使い方</h2>
    <p>それぞれのページに、ゲームの紹介と<b>QRコード</b>が載っています。QRコードを読み取ると、そのゲームの公式ページが開き、そこからアプリを入れられます。</p>
    <ol>
      <li><span class="bignum">1</span><span>スマホの<b>「カメラ」</b>を起動します（写真を撮るときと同じです）。</span></li>
      <li><span class="bignum">2</span><span>カメラを<b>QRコードにかざします</b>。シャッターは押さなくて大丈夫。</span></li>
      <li><span class="bignum">3</span><span>画面に出てくる<b>黄色いお知らせ（リンク）をタッチ</b>すると、公式ページが開きます。</span></li>
      <li><span class="bignum">4</span><span>ページ内の<b>「App Store」または「Google Play」のボタン</b>を押して、アプリを入手します。</span></li>
    </ol>
    <div class="promise">
      <h3>あんしんして遊ぶための3つの約束</h3>
      <ul>
        <li><b>料金表示を確認</b> — 各ページに「無料」「有料」「課金あり」を明記しています。「アプリ内課金あり」でも、<b>課金しなければお金は一切かかりません</b>。</li>
        <li><b>広告はあわてず「×」で閉じる</b> — 無料ゲームでは広告が流れます。数秒待つと出てくる「×」印を押せば閉じられます。広告の中のボタンは押さないようにしましょう。</li>
        <li><b>お金の入力画面が出たら、いったん手を止める</b> — クレジットカード番号などを求められたら、その場で入力せず、家族に相談しましょう。</li>
      </ul>
    </div>
  </section>"""

TOC_PAGE1 = f"""
  <section class="page">
    <h2 class="sec">もくじ　— 収録ゲーム30本 —</h2>
{toc([1, 2, 3])}
  </section>"""

TOC_PAGE2 = f"""
  <section class="page">
    <h2 class="sec">もくじ　（つづき）</h2>
{toc([4, 5, 6])}
  </section>"""

ENDNOTE = """
  <section class="page endnote">
    <h2 class="sec">こまったときは</h2>
    <h3>QRコードがうまく読めないとき</h3>
    <ul>
      <li>スマホを少し（20〜30cm）はなして、QRコード全体が画面に入るようにしましょう。</li>
      <li>明るい場所で読み取りましょう。紙が光って反射するときは角度を変えて。</li>
      <li>それでも読めないときは、インターネットでゲーム名を検索しても見つかります。</li>
    </ul>
    <h3>「アプリ内課金あり」ってなに？</h3>
    <p>ゲーム自体は無料でも、ゲーム内の道具などをお金で買える仕組みのことです。<b>自分で「購入」ボタンを押さないかぎり、お金はかかりません。</b>心配な方は、スマホの設定で課金にパスワードや指紋の確認を必ず求めるようにしておくと安心です（お使いの機種の設定は、ご家族や携帯ショップにご相談ください）。</p>
    <h3>広告とのつきあい方</h3>
    <p>無料ゲームは、広告を見てもらうことで成り立っています。広告が流れたら、あわてずに数秒待ち、「×」印や「スキップ」を押して閉じましょう。<b>広告の中の「ダウンロード」ボタンなどは押す必要はありません。</b></p>
    <div class="fine">
      <p>※ 掲載内容・URL・料金は2026年7月時点の情報です。アプリの内容や料金は変わることがあります。</p>
      <p>※ 各ゲームの名称・ロゴは、それぞれの権利者に帰属します。本書は各社の公式ページへの案内のみを行っています。</p>
    </div>
  </section>"""

COLOPHON = """
  <section class="page colophon">
    <div class="c-box">
      <h2>QR便利帳シリーズ<br>スマホの便利帳　ゲーム編</h2>
      <table>
        <tr><td>発行日</td><td>2026年7月　初版</td></tr>
        <tr><td>発行</td><td>ひらちゃんのAI＆デジタル生活サポート</td></tr>
        <tr><td>発行者</td><td>平岩 篤史</td></tr>
      </table>
      <div class="c-note">
        <p>本書の内容の無断転載を禁じます。</p>
        <p>掲載しているQRコード・URL・料金・サービス内容は2026年7月時点の情報であり、予告なく変更・終了されることがあります。各アプリのご利用は、それぞれの利用規約に従い、ご自身の判断でお願いいたします。</p>
        <p>本書に掲載した各ゲームの名称は各社の商標または登録商標です。本書は各ゲームの提供元とは関係のない、独立した案内書です。</p>
        <p>QRコードは（株）デンソーウェーブの登録商標です。</p>
      </div>
    </div>
  </section>"""

# 1セクション = 1ページ。表紙以外にノンブル（ページ番号）を入れる
sections = [COVER, HOWTO, TOC_PAGE1, TOC_PAGE2] + [game_page(i, g) for i, g in enumerate(GAMES, 1)] + [ENDNOTE, COLOPHON]
numbered = [sections[0]]
for n, sec in enumerate(sections[1:], 2):
    numbered.append(sec.replace("</section>", f'<div class="folio">— {n} —</div>\n  </section>'))
body = "\n".join(numbered)

html_doc = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>QR便利帳 スマホの便利帳 ゲーム編（A5判）</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  @page {{ size: 148mm 210mm; margin: 0; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{
    font-family: "Noto Sans CJK JP", "Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN",
                 "BIZ UDGothic", "Yu Gothic", "Meiryo", sans-serif;
    color: #222;
    font-size: 12.5px;
    line-height: 1.62;
  }}
  .page {{
    width: 148mm;
    height: 210mm;
    padding: 10mm 12mm 14mm;
    page-break-after: always;
    overflow: hidden;
    position: relative;
    background: #fff;
  }}
  .folio {{
    position: absolute; bottom: 5mm; left: 0; right: 0;
    text-align: center; font-size: 9px; color: #999;
  }}

  /* ---------- 表紙 ---------- */
  .cover {{
    text-align: center;
    background: linear-gradient(160deg, #fffdf5 0%, #ffedbe 100%);
    padding-top: 30mm;
  }}
  .cover .series {{
    display: inline-block; background: #e8b93f; color: #fff; font-weight: bold;
    padding: 4px 22px; border-radius: 999px; font-size: 14px; letter-spacing: .2em;
  }}
  .cover h1 {{ font-size: 34px; margin: 14mm 0 3mm; letter-spacing: .06em; }}
  .cover .vol {{ font-size: 22px; color: #b3541e; font-weight: bold; letter-spacing: .1em; }}
  .cover .emoji {{ font-size: 44px; margin: 12mm 0 6mm; letter-spacing: .08em; }}
  .cover .lead {{ font-size: 14px; margin-top: 6mm; line-height: 2; }}
  .cover .pub {{ position: absolute; bottom: 14mm; left: 0; right: 0; color: #8a7a55; font-size: 11px; }}

  /* ---------- 共通見出し ---------- */
  h2.sec {{ font-size: 20px; border-left: 8px solid #e8b93f; padding-left: 10px; margin-bottom: 6mm; }}

  /* ---------- 使い方 ---------- */
  .howto > p {{ margin-bottom: 5mm; }}
  .howto ol {{ list-style: none; }}
  .howto li {{ display: flex; gap: 9px; align-items: flex-start; margin-bottom: 3.5mm; font-size: 13px; }}
  .bignum {{
    flex: none; width: 26px; height: 26px; border-radius: 50%;
    background: #e8b93f; color: #fff; font-weight: bold; font-size: 15px;
    display: flex; align-items: center; justify-content: center; margin-top: 1px;
  }}
  .promise {{ background: #fff8e6; border: 1.5px solid #e8b93f; border-radius: 8px; padding: 4mm 5mm; margin-top: 6mm; }}
  .promise h3 {{ font-size: 14px; color: #b3541e; margin-bottom: 2mm; }}
  .promise li {{ margin-left: 1.4em; margin-bottom: 1.5mm; font-size: 12px; }}

  /* ---------- 目次 ---------- */
  .toc-cat {{
    margin: 2.6mm 0 1mm; padding: 1.2mm 3mm; border-radius: 4px;
    background: var(--bg); color: var(--c); font-weight: bold; font-size: 12.5px;
  }}
  .toc-row {{ display: flex; gap: 8px; padding: 0.7mm 3mm; border-bottom: 1px dashed #ddd; font-size: 11.5px; }}
  .toc-no {{ font-weight: bold; color: #999; }}
  .toc-name {{ flex: 1; }}
  .toc-page {{ color: #999; font-size: 10px; }}

  /* ---------- ゲームページ ---------- */
  .game {{ border-top: 4mm solid var(--c); }}
  .game-head {{ display: flex; justify-content: space-between; align-items: center; margin-top: 1mm; }}
  .game-cat {{
    background: var(--bg); color: var(--c); font-weight: bold;
    padding: 1mm 4mm; border-radius: 999px; font-size: 10.5px;
  }}
  .game-no {{ font-size: 19px; font-weight: bold; color: var(--c); }}
  .game-no span {{ font-size: 11px; color: #aaa; }}
  .game-name {{ font-size: 23px; margin-top: 2.5mm; line-height: 1.25; }}
  .game-kana {{ color: #888; font-size: 10px; margin-bottom: 2mm; }}
  .price {{
    display: inline-block; background: #e8f5e9; color: #2e7d32; font-weight: bold;
    border-radius: 5px; padding: 0.8mm 3mm; font-size: 11px; margin-bottom: 2.5mm;
  }}
  .price.paid {{ background: #fff3e0; color: #b3541e; }}
  .price.nft {{ background: #fdecea; color: #b71c1c; }}
  .game h3 {{
    font-size: 13.5px; color: var(--c); margin: 2.5mm 0 1.5mm;
    border-bottom: 1.5px solid var(--bg); padding-bottom: 0.8mm;
  }}
  .steps {{ list-style: none; }}
  .steps li {{ display: flex; gap: 7px; margin-bottom: 1.5mm; }}
  .stepnum {{
    flex: none; width: 19px; height: 19px; border-radius: 50%;
    background: var(--c); color: #fff; font-weight: bold;
    display: flex; align-items: center; justify-content: center; margin-top: 2px; font-size: 11px;
  }}
  .steptext {{ flex: 1; }}
  .osusume {{ background: var(--bg); border-radius: 7px; padding: 2.5mm 4mm; margin-top: 2.5mm; }}
  .osusume-title {{ font-weight: bold; color: var(--c); }}
  .caution {{
    background: #fffde7; border: 1.5px solid #f6c344; border-radius: 7px;
    padding: 2.5mm 4mm; margin-top: 2mm; font-size: 11px; line-height: 1.55;
  }}
  .caution-title {{ font-weight: bold; color: #9a6c00; }}
  .caution-strong {{ background: #fdecea; border-color: #d9534f; font-size: 10.5px; }}
  .caution-strong .caution-title {{ color: #b71c1c; }}

  /* ---------- QR（ページ下部・横並び） ---------- */
  .qr-area {{
    position: absolute; left: 12mm; right: 12mm; bottom: 11mm;
    display: flex; gap: 5mm; align-items: center; justify-content: space-between;
    background: #fafafa; border: 1.5px solid #e5e0d5; border-radius: 8px; padding: 3.5mm 5mm;
  }}
  .qr-side {{ flex: 1; text-align: left; }}
  .qr-title {{ font-weight: bold; font-size: 13px; margin-bottom: 1mm; }}
  .qr-hint {{ font-size: 10.5px; color: #555; line-height: 1.5; }}
  .qr-url {{ color: #888; font-size: 9px; margin-top: 1mm; word-break: break-all; }}
  .qr-one {{ flex: none; text-align: center; }}
  .qr {{ width: 33mm; height: 33mm; display: block; }}
  .qr-s {{ width: 27mm; height: 27mm; }}
  .qr-device {{ font-weight: bold; font-size: 10px; margin-bottom: 0.5mm; }}

  /* ---------- 巻末・奥付 ---------- */
  .endnote p, .endnote li {{ font-size: 11.5px; }}
  .endnote h3 {{ font-size: 14px; color: #b3541e; margin: 4mm 0 1.5mm; }}
  .endnote ul {{ margin-left: 1.5em; }}
  .fine {{ color: #888; font-size: 9.5px; margin-top: 6mm; line-height: 1.6; }}
  .colophon {{ display: flex; flex-direction: column; justify-content: flex-end; }}
  .colophon .c-box {{ border-top: 1.5px solid #222; padding-top: 5mm; margin-bottom: 6mm; }}
  .colophon h2 {{ font-size: 16px; margin-bottom: 4mm; }}
  .colophon table {{ border-collapse: collapse; font-size: 11px; }}
  .colophon td {{ padding: 1mm 3mm 1mm 0; vertical-align: top; }}
  .colophon td:first-child {{ color: #777; white-space: nowrap; }}
  .colophon .c-note {{ color: #888; font-size: 9.5px; margin-top: 4mm; line-height: 1.6; }}
</style>
</head>
<body>
{body}
</body>
</html>
"""

with open(OUT_HTML, "w", encoding="utf-8") as f:
    f.write(html_doc)
print(f"HTML OK ({len(html_doc)} chars, {len(sections)} pages)")

# ---------- PDF化 ----------
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
    pg = b.new_page()
    import os
    pg.goto(f"file://{os.path.abspath(OUT_HTML)}")
    pg.pdf(
        path=OUT_PDF,
        width="148mm",
        height="210mm",
        print_background=True,
        margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
    )
    b.close()
print(f"PDF OK: {OUT_PDF}")
