"""v3.1 视觉稿检查的反向探针：在稿子上故意改坏 13 处（每行各画框、框断开、选中空格子、1/16 橙条……），
确认 design/check_mockups_v31.py 的浏览器断言每一处都报错。用法：python -I evidence/ct_602f941f/run_negative_checks_v31.py（在仓库根目录跑）"""
import sys, pathlib, importlib.util
spec = importlib.util.spec_from_file_location("chk", "design/check_mockups_v31.py"); chk = importlib.util.module_from_spec(spec); spec.loader.exec_module(chk)
from playwright.sync_api import sync_playwright
mock = pathlib.Path("design/mockups_v31").resolve()
CASES = [
 ("column", "每行各画框", "document.querySelectorAll('[data-selected=\"1\"]').forEach(c=>c.style.boxShadow='inset 0 0 0 2px #C2410C')"),
 ("column", "框断成两段", "const b=document.querySelector('[data-role=selection-box]'); const b2=b.cloneNode(); b.parentNode.appendChild(b2); b.style.height=(parseFloat(b.style.height)/2)+'px'"),
 ("column", "选中空格子", "document.querySelector('[data-key=\"10:2\"]').dataset.selected='1'"),
 ("column", "标题不垫色", "document.querySelectorAll('[data-role=selection-band]').forEach(e=>e.remove())"),
 ("column", "1/16 橙条", "const s=document.createElement('span'); s.style.cssText='position:absolute;left:30%;width:25%;top:0;bottom:0;background:#C2410C'; document.querySelector('[data-role=beat-head][data-beat=\"1\"]').appendChild(s)"),
 ("column", "16分小格按钮", "const s=document.createElement('button'); s.className='sub'; s.dataset.role='sub-tick'; document.querySelector('[data-role=beat-head][data-beat=\"1\"]').appendChild(s)"),
 ("select", "字框回来", "document.querySelectorAll('[data-role=word]').forEach(w=>w.style.border='1px solid #999')"),
 ("select", "浅底没到头", "const t=document.querySelector('[data-role=hold-tint]'); t.dataset.e=+t.dataset.e-12"),
 ("select", "浅底位置偏", "const t=document.querySelector('[data-role=hold-tint]:not(.more)'); t.style.right='30%'"),
 ("edit", "写进下一拍", "document.querySelector('[data-key=\"4:2\"] [data-role=word] .ch').textContent='慢'"),
 ("split", "没平分", "document.querySelector('[data-key=\"10:1\"] [data-role=word]').dataset.tick='12'"),
 ("hold", "跨行没接上", "document.querySelectorAll('[data-role=hold-preview]').forEach(p=>{ if(+p.dataset.s===9*192) p.style.left='20px'; })"),
 ("section", "菜单少一项", "document.querySelector('[data-kind=bridge]').remove()"),
]
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    for screen, name, js in CASES:
        for w, h in ((1280, 800),):
            pg = b.new_page(viewport={"width": w, "height": h})
            pg.goto((mock / f"{screen}.html").as_uri()); pg.wait_for_timeout(200)
            pg.evaluate("() => {" + js + "}")
            info = pg.evaluate(chk.PROBE_JS, {"words": list(chk.BANNED_TEXT), "minFont": 11, "screen": screen, "desktop": True})
            caught = bool(info["errs"])
            bad += not caught
            print(("抓到 " if caught else "漏了 ") + f"{screen} · {name}：{info['errs'][:2]}")
            pg.close()
    b.close()
sys.exit(1 if bad else 0)
