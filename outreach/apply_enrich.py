import csv, json, re
E = {
 "beautylablaser.com":(15,2,None,"medical practice"),
 "luxmedspabrickell.com":(7,0,None,"health, wellness & fitness"),
 "cosmeticamedspa.com":(3,0,None,"health, wellness & fitness"),
 "spaderma.com":(130,1,61290000,"medical practice"),
 "truejewelcosmeticcenter.com":(7,0,None,"medical practice"),
 "estheticscenter.com":(39,4,None,"health, wellness & fitness"),
 "cloud9.spa":(4,0,None,""),
 "adornmedspa.com":(4,0,None,""),
 "honoluluspaandwellness.com":(2,1,None,"health, wellness & fitness"),
 "thrivedripspa.com":(32,0,None,"health, wellness & fitness"),
 "aestheticelement.com":(6,0,None,"information technology & services"),
 "summit.woodhousespas.com":(2500,48,15620000,"health, wellness & fitness"),
 "bellareinaspa.com":(12,1,23447000,"health, wellness & fitness"),
 "cellrenewtampa.com":(5,0,None,"medical practice"),
 "bossgalbeautybar.com":(31,5,None,"health, wellness & fitness"),
 "vivalamedspa.com":(22,0,None,"medical practice"),
 "newulasvegas.com":(10,0,44000,"individual & family services"),
 "cocoondayspa.com":(18,0,None,"health, wellness & fitness"),
 "nakedmd.com":(150,40,None,"medical practice"),
 "medspaatvillagio.com":(3,0,None,""),
 "whitepearlmedicalspa.com":(5,0,None,"medical practice"),
 "spasasse.com":(9,1,None,"health, wellness & fitness"),
 "botanicadayspa.com":(15,0,5529000,"cosmetics"),
 "rejuvcryo.com":(2,0,None,""),
 "lemmonavenueplasticsurgery.com":(2,0,None,"medical practice"),
 "waxingbyceleste.com":(8,1,None,"consumer services"),
 "ellemesmedspa.com":(4,0,None,"health, wellness & fitness"),
 "tulumwellness.com":(12,0,None,"health, wellness & fitness"),
 "medaestheticsmiami.com":(4,0,5955000,"health, wellness & fitness"),
 "chiclavie.com":(5,1,None,"medical practice"),
 "sugarlandmedspa.com":(3,0,None,"individual & family services"),
 "metropolisdermatology.com":(43,0,None,"medical practice"),
 "aestheticamedspanj.com":(14,0,None,"medical practice"),
 "naturamedspaivbar.com":(17,0,None,"health, wellness & fitness"),
}
def seg(n):
    if n is None: return ""
    if n>=100: return "Enterprise / chain"
    if n>=15: return "Core (best fit)"
    if n>=7:  return "Small"
    return "Micro / owner-operated"
def dom(u):
    m=re.search(r"https?://(?:www\.)?([^/?#]+)", u or ""); return m.group(1).lower() if m else None

rows=list(csv.DictReader(open('MASTER_send_list.csv')))
flds=list(rows[0].keys())
for c in ("Locations","Revenue","Apollo industry"):
    if c not in flds: flds.insert(flds.index("Segment"), c)
hit=0
for r in rows:
    d=dom(r['Website'])
    if d in E:
        n,loc,rev,ind = E[d]
        r['Employees']=str(n); r['Segment']=seg(n)
        r['Locations']=str(loc) if loc else ""
        r['Revenue']=f"${rev/1e6:.1f}M" if rev else ""
        r['Apollo industry']=ind
        hit+=1
    else:
        for c in ("Locations","Revenue","Apollo industry"): r.setdefault(c,"")
with open('MASTER_send_list.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=flds,extrasaction='ignore'); w.writeheader(); w.writerows(rows)
print("rows updated:",hit)
from collections import Counter
print("now enriched:",sum(1 for r in rows if r['Employees'].strip()),"of",len(rows))
print(Counter(r['Segment'] for r in rows if r['Segment'].strip()))
