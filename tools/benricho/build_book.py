# -*- coding: utf-8 -*-
"""QR便利帳 スマホの便利帳 ゲーム編 のHTMLを生成する。"""
import html
import qrcode
from games_data import GAMES

OUT = "benricho-game.html"

CAT_META = {
    "おさんぽ・おでかけ":   dict(no=1, color="#2e7d32", bg="#e8f5e9", icon="🚶"),
    "のんびり・いやし":     dict(no=2, color="#ef6c00", bg="#fff3e0", icon="🐈"),
    "定番パズル":           dict(no=3, color="#1565c0", bg="#e3f2fd", icon="🧩"),
    "頭の体操":             dict(no=4, color="#6a1b9a", bg="#f3e5f5", icon="💡"),
    "囲碁・将棋・テーブル": dict(no=5, color="#5d4037", bg="#efebe9", icon="🎴"),
    "家族で話題・有名ゲーム": dict(no=6, color="#c62828", bg="#ffebee", icon="🎮"),
}


def qr_svg(url: str, css_class: str = "qr") -> str:
    """URLをQRコード(インラインSVG)にする。"""
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    n = len(matrix)
    parts = []
    for y, row in enumerate(matrix):
        x = 0
        while x < n:
            if row[x]:
                x0 = x
                while x < n and row[x]:
                    x += 1
                parts.append(f"M{x0} {y}h{x - x0}v1h-{x - x0}z")
            else:
                x += 1
    d = "".join(parts)
    return (
        f'<svg class="{css_class}" viewBox="0 0 {n} {n}" role="img" '
        f'aria-label="QRコード" shape-rendering="crispEdges">'
        f'<rect width="{n}" height="{n}" fill="#fff"/>'
        f'<path d="{d}" fill="#111"/></svg>'
    )


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def short_url(url: str) -> str:
    u = url.replace("https://", "").replace("http://", "")
    if "play.google.com" in u:
        return "Google Play ストア"
    if "apps.apple.com" in u:
        return "App Store"
    return u.rstrip("/")


def qr_block(g: dict) -> str:
    kind = g["qr"][0]
    if kind == "site":
        url = g["qr"][1]
        return f"""
      <div class="qr-area">
        <div class="qr-one">
          {qr_svg(url)}
          <div class="qr-label">公式ページが開きます</div>
          <div class="qr-url">{esc(short_url(url))}</div>
        </div>
        <p class="qr-hint">スマホのカメラをこのQRコードにかざして、画面に出る黄色いお知らせ（リンク）をタッチしてください。</p>
      </div>"""
    _, ios, android = g["qr"]
    return f"""
      <div class="qr-area">
        <div class="qr-two">
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
        </div>
        <p class="qr-hint">お使いのスマホに合うほうのQRコードに、カメラをかざしてください。</p>
      </div>"""


def price_class(price: str) -> str:
    if price.startswith("有料"):
        return "price paid"
    if "NFT" in price:
        return "price nft"
    return "price"


def game_page(idx: int, g: dict) -> str:
    m = CAT_META[g["cat"]]
    steps = "\n".join(
        f'<li><span class="stepnum">{i + 1}</span><span class="steptext">{esc(s)}</span></li>'
        for i, s in enumerate(g["steps"])
    )
    caution = ""
    if g.get("caution"):
        strong = "お金" in g["caution"] or "NFT" in g["caution"]
        title = "⚠️ お金にかかわる大切な注意" if strong else "ご注意"
        caution = f"""
      <div class="caution{' caution-strong' if strong else ''}">
        <div class="caution-title">{title}</div>
        <p>{esc(g["caution"])}</p>
      </div>"""
    return f"""
  <section class="page game" id="game{idx:02d}" style="--c:{m['color']};--bg:{m['bg']}">
    <header class="game-head">
      <div class="game-cat">{m['icon']} 第{m['no']}章　{esc(g['cat'])}</div>
      <div class="game-no">{idx:02d}<span>/30</span></div>
    </header>
    <h2 class="game-name">{esc(g['name'])}</h2>
    <div class="game-kana">{esc(g['kana'])}</div>
    <div class="{price_class(g['price'])}">料金：{esc(g['price'])}</div>
    <div class="game-body">
      <div class="game-text">
        <h3>どんなゲーム？</h3>
        <p>{esc(g['what'])}</p>
        <h3>あそびかた</h3>
        <ol class="steps">
{steps}
        </ol>
        <div class="osusume">
          <div class="osusume-title">😊 ここがおすすめ</div>
          <p>{esc(g['point'])}</p>
        </div>{caution}
      </div>
      {qr_block(g)}
    </div>
  </section>"""


def toc() -> str:
    rows = []
    cur = None
    for i, g in enumerate(GAMES, 1):
        if g["cat"] != cur:
            cur = g["cat"]
            m = CAT_META[cur]
            rows.append(
                f'<div class="toc-cat" style="--c:{m["color"]};--bg:{m["bg"]}">'
                f'{m["icon"]} 第{m["no"]}章　{esc(cur)}</div>'
            )
        rows.append(
            f'<a class="toc-row" href="#game{i:02d}">'
            f'<span class="toc-no">{i:02d}</span>'
            f'<span class="toc-name">{esc(g["name"])}</span></a>'
        )
    return "\n".join(rows)


pages = "\n".join(game_page(i, g) for i, g in enumerate(GAMES, 1))

html_doc = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QR便利帳 スマホの便利帳 ゲーム編</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  html {{ -webkit-text-size-adjust: 100%; }}
  body {{
    font-family: "Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN",
                 "BIZ UDGothic", "Yu Gothic", "Meiryo", sans-serif;
    background: #f3ede2;
    color: #222;
    font-size: 18px;
    line-height: 1.75;
  }}
  .page {{
    max-width: 860px;
    margin: 24px auto;
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 2px 10px rgba(0,0,0,.08);
    padding: 36px 40px;
  }}

  /* ---------- 表紙 ---------- */
  .cover {{
    text-align: center;
    padding: 70px 40px;
    background: linear-gradient(160deg, #fffdf5 0%, #fff3d6 100%);
    border: 3px solid #e8b93f;
  }}
  .cover .series {{
    display: inline-block;
    background: #e8b93f;
    color: #fff;
    font-weight: bold;
    padding: 6px 26px;
    border-radius: 999px;
    font-size: 20px;
    letter-spacing: .2em;
  }}
  .cover h1 {{ font-size: 46px; margin: 28px 0 6px; letter-spacing: .06em; }}
  .cover .vol {{ font-size: 30px; color: #b3541e; font-weight: bold; letter-spacing: .1em; }}
  .cover .emoji {{ font-size: 72px; margin: 26px 0 10px; letter-spacing: .08em; }}
  .cover .lead {{ font-size: 21px; margin-top: 16px; }}
  .cover .pub {{ margin-top: 44px; color: #8a7a55; font-size: 15px; }}

  /* ---------- 使い方・共通 ---------- */
  h2.sec {{ font-size: 30px; border-left: 12px solid #e8b93f; padding-left: 14px; margin-bottom: 22px; }}
  .howto ol {{ list-style: none; }}
  .howto li {{ display: flex; gap: 14px; align-items: flex-start; margin-bottom: 18px; font-size: 20px; }}
  .bignum {{
    flex: none; width: 44px; height: 44px; border-radius: 50%;
    background: #e8b93f; color: #fff; font-weight: bold; font-size: 24px;
    display: flex; align-items: center; justify-content: center; margin-top: 2px;
  }}
  .promise {{ background: #fff8e6; border: 2px solid #e8b93f; border-radius: 12px; padding: 20px 24px; margin-top: 28px; }}
  .promise h3 {{ font-size: 22px; color: #b3541e; margin-bottom: 10px; }}
  .promise li {{ margin-left: 1.4em; margin-bottom: 8px; }}

  /* ---------- 目次 ---------- */
  .toc-cat {{
    margin: 22px 0 8px; padding: 8px 16px; border-radius: 8px;
    background: var(--bg); color: var(--c);
    font-weight: bold; font-size: 21px;
  }}
  .toc-row {{
    display: flex; gap: 14px; padding: 7px 16px; text-decoration: none; color: #222;
    border-bottom: 1px dashed #ddd; font-size: 19px;
  }}
  .toc-row:hover {{ background: #fdf6e3; }}
  .toc-no {{ font-weight: bold; color: #999; }}

  /* ---------- ゲームページ ---------- */
  .game {{ border-top: 10px solid var(--c); }}
  .game-head {{ display: flex; justify-content: space-between; align-items: center; }}
  .game-cat {{
    background: var(--bg); color: var(--c); font-weight: bold;
    padding: 4px 16px; border-radius: 999px; font-size: 16px;
  }}
  .game-no {{ font-size: 30px; font-weight: bold; color: var(--c); }}
  .game-no span {{ font-size: 16px; color: #aaa; }}
  .game-name {{ font-size: 36px; margin-top: 14px; line-height: 1.3; }}
  .game-kana {{ color: #888; font-size: 16px; margin-bottom: 10px; }}
  .price {{
    display: inline-block; background: #e8f5e9; color: #2e7d32; font-weight: bold;
    border-radius: 8px; padding: 4px 14px; font-size: 17px; margin-bottom: 18px;
  }}
  .price.paid {{ background: #fff3e0; color: #b3541e; }}
  .price.nft {{ background: #fdecea; color: #b71c1c; }}
  .game-body {{ display: flex; gap: 30px; align-items: flex-start; }}
  .game-text {{ flex: 1; min-width: 0; }}
  .game-text h3 {{
    font-size: 21px; color: var(--c); margin: 18px 0 8px;
    border-bottom: 2px solid var(--bg); padding-bottom: 4px;
  }}
  .game-text h3:first-child {{ margin-top: 0; }}
  .steps {{ list-style: none; }}
  .steps li {{ display: flex; gap: 12px; margin-bottom: 10px; }}
  .stepnum {{
    flex: none; width: 32px; height: 32px; border-radius: 50%;
    background: var(--c); color: #fff; font-weight: bold;
    display: flex; align-items: center; justify-content: center; margin-top: 4px; font-size: 17px;
  }}
  .steptext {{ flex: 1; }}
  .osusume {{ background: var(--bg); border-radius: 12px; padding: 14px 18px; margin-top: 16px; }}
  .osusume-title {{ font-weight: bold; color: var(--c); margin-bottom: 4px; }}
  .caution {{
    background: #fffde7; border: 2px solid #f6c344; border-radius: 12px;
    padding: 14px 18px; margin-top: 14px; font-size: 17px;
  }}
  .caution-title {{ font-weight: bold; color: #9a6c00; margin-bottom: 4px; }}
  .caution-strong {{ background: #fdecea; border-color: #d9534f; }}
  .caution-strong .caution-title {{ color: #b71c1c; font-size: 19px; }}

  /* ---------- QR ---------- */
  .qr-area {{
    flex: none; width: 260px; text-align: center;
    background: #fafafa; border: 2px solid #e5e0d5; border-radius: 14px; padding: 18px 14px;
  }}
  .qr {{ width: 200px; height: 200px; }}
  .qr-s {{ width: 150px; height: 150px; }}
  .qr-one {{ margin-bottom: 6px; }}
  .qr-two {{ display: flex; flex-direction: column; gap: 14px; }}
  .qr-device {{ font-weight: bold; font-size: 17px; margin-bottom: 4px; }}
  .qr-label {{ font-weight: bold; margin-top: 6px; }}
  .qr-url {{ color: #888; font-size: 13px; word-break: break-all; }}
  .qr-hint {{ font-size: 14px; color: #666; text-align: left; margin-top: 10px; line-height: 1.6; }}

  /* ---------- 巻末 ---------- */
  .endnote p, .endnote li {{ font-size: 17px; }}
  .endnote h3 {{ font-size: 21px; color: #b3541e; margin: 20px 0 8px; }}
  .endnote ul {{ margin-left: 1.5em; }}
  .fine {{ color: #888; font-size: 14px; margin-top: 26px; line-height: 1.7; }}

  /* ---------- スマホ ---------- */
  @media (max-width: 720px) {{
    .page {{ padding: 24px 18px; margin: 12px 8px; }}
    .game-body {{ flex-direction: column; }}
    .qr-area {{ width: 100%; }}
    .cover h1 {{ font-size: 32px; }}
    .cover .vol {{ font-size: 22px; }}
    .game-name {{ font-size: 28px; }}
  }}

  /* ---------- 印刷 ---------- */
  @media print {{
    body {{ background: #fff; font-size: 13px; line-height: 1.6; }}
    .page {{
      box-shadow: none; border-radius: 0; margin: 0 auto;
      max-width: none; page-break-after: always; padding: 10mm 14mm;
    }}
    .game-name {{ font-size: 26px; }}
    .qr {{ width: 44mm; height: 44mm; }}
    .qr-s {{ width: 34mm; height: 34mm; }}
    .toc-row {{ padding: 3px 16px; }}
    a {{ color: inherit; }}
  }}
</style>
</head>
<body>

  <!-- ============ 表紙 ============ -->
  <section class="page cover">
    <div class="series">QR便利帳シリーズ</div>
    <h1>スマホの便利帳</h1>
    <div class="vol">ゲーム編</div>
    <div class="emoji">🎮🧩🐈🎴</div>
    <p class="lead">スマホで遊べる有名ゲーム 30選<br>QRコードをかざすだけで、すぐはじめられます</p>
    <div class="pub">2026年7月 発行</div>
  </section>

  <!-- ============ この本の使い方 ============ -->
  <section class="page howto">
    <h2 class="sec">この本の使い方</h2>
    <p style="margin-bottom:20px">それぞれのページに、ゲームの紹介と<b>QRコード</b>が載っています。QRコードを読み取ると、そのゲームの公式ページが開き、そこからアプリを入れられます。</p>
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
  </section>

  <!-- ============ 目次 ============ -->
  <section class="page">
    <h2 class="sec">もくじ　— 収録ゲーム30本 —</h2>
{toc()}
  </section>

  <!-- ============ ゲームページ ============ -->
{pages}

  <!-- ============ 巻末 ============ -->
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
      <p>QR便利帳シリーズ「スマホの便利帳 ゲーム編」</p>
    </div>
  </section>

</body>
</html>
"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html_doc)
print(f"OK: {OUT} ({len(html_doc)} chars, {len(GAMES)} games)")
