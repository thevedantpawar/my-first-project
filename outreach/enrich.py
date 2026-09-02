import csv
# domain -> (apollo_name, employees, revenue, corp_phone, founded, retail_locs, city, state, linkedin, note)
E = {
"refreshmedical.com":("Refresh - Aesthetics & Wellness",16,0,"+1 561-246-5115",2023,0,"Jupiter","FL","linkedin.com/company/refreshmedicalaesthetics","Apollo bio claims 10 offices across FL"),
"couturemedical.com":("COUTURE DERMATOLOGY & PLASTIC SURGERY",18,0,"+1 702-998-8282",None,0,"Las Vegas","NV","linkedin.com/company/couture-dermatology-&-plastic-surgery",""),
"elase.com":("Elase Med Spas",230,29200000,"+1 813-365-7113",2004,3,"Salt Lake City","UT","linkedin.com/company/elasemedspas","38 locations, 7 states - national platform"),
"gatewaylasercenter.com":("Gateway Aesthetic Institute & Laser Center",24,0,"+1 801-595-1600",None,1,"Salt Lake City","UT","linkedin.com/company/gateway-aesthetic-institute-&-laser-center",""),
"thepalmmedspa.com":("The Palm Medspa + Wellness",2,0,"+1 407-347-4770",2022,0,"Orlando","FL","linkedin.com/company/the-palm-medspa-wellness","2 employees - owner-operated"),
"capizzimd.com":("Capizzi MD Cosmetic Surgery & Med Spa",9,0,"+1 704-655-8988",2003,0,"Charlotte","NC","linkedin.com/company/capizzimd",""),
"suddenlyslimmer.com":("Suddenly Slimmer Med Spa",19,992000,"+1 602-952-8446",1988,2,"Phoenix","AZ","linkedin.com/company/suddenlyslimmer",""),
"kumimedspa.com":("Kumi Laser & Medspa",4,0,"+1 281-206-7570",None,0,"Katy","TX","linkedin.com/company/kumi-laser-&-medspa","4 employees - very small"),
"lecadatampa.com":("Lecada Medical Artistry",10,701000,"+1 813-874-2332",None,0,"Tampa","FL","linkedin.com/company/lecada-medical-artistry","headcount down 22% in 6mo"),
"winterparklaser.com":("Winter Park Laser & Anti-Aging Center",10,5097000,"+1 407-601-1185",2004,0,"Winter Park","FL","linkedin.com/company/winter-park-laser-&-anti-aging-center",""),
"imagedermatology.com":("Image Dermatology",11,6014000,"+1 973-509-6900",None,2,"Montclair","NJ","linkedin.com/company/image-dermatology","Dr. Jeanine Downie"),
"aventuradermatology.com":("Aventura Dermatology & Aesthetics",3,16304000,"+1 754-544-9030",None,0,"Aventura","FL","linkedin.com/company/aventura-dermatology-aesthetics","3 employees; revenue figure looks unreliable"),
"modernslc.com":("Modern SLC Injections & Aesthetics",3,0,"+1 801-516-8884",None,0,"Holladay","UT","linkedin.com/company/modern-slc-injections-&-aesthetics","city is Holladay not SLC"),
"luminescence-aesthetics.com":("Luminescence Aesthetics",8,0,"+1 716-800-1916",2021,0,"Buffalo","NY","linkedin.com/company/luminescence-aesthetics","workbook state may be wrong - Apollo says NY"),
"elamarskin.com":("ElaMar Esthetics",11,31951000,"+1 256-686-9111",2013,0,"Decatur","AL","linkedin.com/company/elamar","revenue figure looks unreliable"),
"prickdmedspa.com":("PRICK'D MedSpa",3,0,"+1 314-256-1290",2023,0,"Richmond Heights","MO","linkedin.com/company/prick-d-medspa",""),
"thebeautyclinic.com":("The Beauty Clinic",2,0,"+1 305-882-9439",2019,0,"North Miami Beach","FL","linkedin.com/company/tbcbacup","Apollo classes as cosmetics supplier, not clinic"),
"skinpharm.com":("Skin Pharm",140,0,"+1 512-540-0519",2017,0,"Nashville","TN","linkedin.com/company/skinpharm","multi-city chain - enterprise motion"),
"newimageworks.com":("New Image Works Inc",9,0,"+1 224-432-5803",None,0,"Glenview","IL","linkedin.com/company/new-image-works-inc","Apollo HQ is IL, not NJ/FL"),
"glowmedspa.com":("Glow MedSpa Texas",5,0,"+1 833-456-9633",2007,0,"Colleyville","TX","linkedin.com/company/glow-medspa-texas",""),
"viomedspa.com":("VIO Med Spa",330,4866000,"+1 440-238-6898",2017,0,"Franklin","TN","linkedin.com/company/viomedspa","franchise, 330 staff - enterprise motion"),
"alliswellspa.com":("All Is Well Holistic Spa",4,0,"+1 832-913-8186",2016,0,"Katy","TX","linkedin.com/company/alliswellspa","holistic spa, not med spa"),
"revivephilly.com":("Revive Medical LLC",1,0,"+1 844-738-4832",2017,0,"Philadelphia","PA","linkedin.com/company/revive-medical-llc","1 employee"),
"essence-medspa.com":("Essence MedSpa & Wellness Center",8,0,"+1 773-763-1212",None,0,"Chicago","IL","linkedin.com/company/essence-medspa-&-wellness-center",""),
"serenitymedspa.com":("SERENITY MEDSPA LLC",20,5082000,"+1 415-781-9200",None,0,"San Francisco","CA","linkedin.com/company/serenity-medspa-llc","headcount down 29%"),
"juvly.com":("Juvly Aesthetics",53,483000,"+1 614-500-7000",2014,1,"Columbus","OH","linkedin.com/company/juvly-com","11 locations, 5 states"),
"charlotteplasticsurgery.com":("Charlotte Plastic Surgery",44,10836000,"+1 704-372-6846",1951,1,"Charlotte","NC","linkedin.com/company/charlotte-plastic-surgery","founded 1951"),
"manhattan-dermatology.com":("Manhattan Dermatology - Manhattan Beach, CA",18,0,"+1 310-546-1188",2011,3,"Manhattan Beach","CA","linkedin.com/company/manhattan-dermatology","Dr. Ashley Magovern"),
"pacboca.com":("Prestige Aesthetics Clinic",3,0,"+1 561-235-7300",2018,0,"Boca Raton","FL","linkedin.com/company/prestige-aesthetics-clinic",""),
"basisaesthetics.com":("Basis Aesthetics",6,0,"+1 561-774-2296",None,0,"Delray Beach","FL","linkedin.com/company/basis-aesthetics","city Delray Beach"),
"artistikbeautyfl.com":("ARTISTIK BEAUTY",3,0,"+1 407-759-8807",None,0,"Winter Park","FL","linkedin.com/company/artistik-beauty","REAL DOMAIN artistikbeauty.net - workbook domain wrong"),
"primemdcenter.com":("PrimeMD Aesthetics+Wellness",7,6242000,"+1 919-948-6355",2009,0,"Raleigh","NC","linkedin.com/company/primemd-aesthetics-wellness","headcount down 33% 12mo"),
"beautycoraleigh.com":("BeautyCo.",12,0,"+1 984-222-0026",2019,0,"Raleigh","NC","linkedin.com/company/beautyco.-raleigh","REAL DOMAIN btyco.com - workbook domain wrong"),
"med1aesthetics.com":("Med 1 Aesthetics",2,0,"+1 734-780-7070",None,0,"Ann Arbor","MI","linkedin.com/company/med-1-aesthetics","Dr. Nicole O'Neill"),
"naturalbeautylaser.com":("Natural Beauty Laser & Skin Care",1,6256000,"+1 561-926-1392",None,0,"Boca Raton","FL","linkedin.com/company/natural-beauty-laser-&-skin-care","1 employee; revenue unreliable"),
"goldenglowmedicalspa.com":("Golden Glow Medical Spa",7,3300000,"+1 727-683-0894",None,0,"Largo","FL","linkedin.com/company/goldenglowmedicalspa",""),
"youthfulmedicalspa.com":("Youthful Medical Spa",25,27639000,"+1 904-273-6286",2006,2,"Ponte Vedra Beach","FL","linkedin.com/company/youthful-medical-spa",""),
"southbaymedspa.com":("South Bay Med Spa",8,0,"+1 310-974-6160",None,0,"Torrance","CA","linkedin.com/company/south-bay-med-spa","REAL DOMAIN southbaymedicalspa.com - workbook domain wrong"),
"shinobayderm.com":("Shino Bay Cosmetic Dermatology & Laser Institute",21,6390000,"+1 954-765-3005",2006,2,"Fort Lauderdale","FL","linkedin.com/company/shino-bay-cosmetic-dermatology-plastic-surgery-&-laser-institute",""),
"enigmamedispa.com":("Enigma Medi Spa",2,23426000,"+1 215-717-7000",None,0,"Philadelphia","PA","linkedin.com/company/enigma-medi-spa","revenue figure looks unreliable vs 2 staff"),
"tremedspa.com":("Tre Medspa",1,0,"+1 813-749-0918",None,0,"Tampa","FL","linkedin.com/company/tre-medspa","1 employee"),
"stlouisskin.com":("St. Louis Skin Solutions",13,14037000,"+1 314-543-4015",2004,1,"St. Louis","MO","linkedin.com/company/stlouisskinsolutions","Dr. Amy Miller"),
"cmamedicine.com":("CMA Medicine",16,0,"+1 904-772-5828",2016,0,"Jacksonville","FL","linkedin.com/company/cma-medicine","Dr. Konika Schallen"),
"pureluxemedical.com":("Pure Luxe Medical",4,0,"+1 424-277-1642",None,0,"El Segundo","CA","linkedin.com/company/pure-luxe-medical",""),
"onestopaesthetictravelandwellness.com":("Onestop Medical Center",3,0,"+1 925-263-9547",None,0,"Pleasanton","CA","linkedin.com/company/onestop-aesthetic-travel-and-wellness-center",""),
"barraesthetics.com":("Barr Aesthetics",6,9155000,"+1 801-532-0204",None,0,"Salt Lake City","UT","linkedin.com/company/barr-aesthetics","Dr. Lucy Barr, plastic surgeon"),
"restormedicalspa.com":("RESTOR",19,0,"+1 720-524-8429",2011,0,"Denver","CO","linkedin.com/company/restor-medical-practice","3 CO locations, plans 20"),
"couturemedspa.com":("Couture Med Spa",39,0,"+1 407-907-6300",None,0,"Winter Park","FL","linkedin.com/company/couture-med-spa",""),
"ecobelmedspa.com":("Ecobel Med Spa",6,7091000,"+1 404-960-0812",None,0,"Atlanta","GA","linkedin.com/company/ecobel-med-spa","no website on Apollo record"),
"dermanimedspa.com":("Dermani Medspa",82,28909000,"+1 770-212-2242",2013,0,"Buford","GA","linkedin.com/company/dermani-medspa","chain - enterprise motion"),
"michiganadvancedaesthetics.com":("Michigan Advanced Aesthetics",4,8088000,"+1 248-542-3700",2008,2,"Royal Oak","MI","linkedin.com/company/michigan-advanced-aesthetics",""),
"amerejuve.com":("Amerejuve Inc. (MedSpa & Cosmetic Surgery)",46,12308000,"+1 713-960-6262",2008,7,"Houston","TX","linkedin.com/company/amerejuve-inc-medspa-&-cosmetic-surgery-","7 locations TX + GA"),
"alluremedical.com":("Allure Medical",150,35600000,"+1 866-212-8690",2004,2,"Shelby Township","MI","linkedin.com/company/allure-medical-spa","14 locations, 3 states - enterprise"),
}
MISSING={"nobhillaesthetics.com","tolmanmedical.com","dermave-spa.com","beyouthful.com","viivwellnesshaus.com"}

rows=list(csv.DictReader(open('medspa_qualified_leads.csv',encoding='utf-8')))
def seg(n):
    if n is None: return "Unknown"
    if n>=50: return "Enterprise / chain"
    if n>=15: return "Core (best fit)"
    if n>=7:  return "Small"
    return "Micro / owner-operated"

out=[]
for r in rows:
    d=r['Email'].split('@')[-1].lower()
    e=E.get(d)
    if e:
        nm,emp,rev,ph,fy,rl,ct,st,li,note=e
        r.update({'Apollo name':nm,'Employees':emp,'Revenue':(f"${rev:,.0f}" if rev else ""),
                  'Corporate phone':ph,'Founded':fy or "",'Apollo city':f"{ct}, {st}",
                  'LinkedIn':li,'Segment':seg(emp),'Enrichment note':note})
    else:
        r.update({'Apollo name':"",'Employees':"",'Revenue':"",'Corporate phone':"",'Founded':"",
                  'Apollo city':"",'LinkedIn':"",'Segment':"Unknown",
                  'Enrichment note':"no Apollo match" if d in MISSING else ""})
    out.append(r)

def sk(r):
    e=r['Employees']; e=e if isinstance(e,int) else -1
    rank={"Core (best fit)":0,"Small":1,"Enterprise / chain":2,"Micro / owner-operated":3,"Unknown":4}[r['Segment']]
    return (rank,-int(r['Fit score']),-e)
out.sort(key=sk)

cols=list(rows[0].keys())
for c in ['Segment','Employees','Revenue','Apollo name','Corporate phone','Founded','Apollo city','LinkedIn','Enrichment note']:
    if c not in cols: cols.append(c)
with open('medspa_qualified_leads_enriched.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=cols); w.writeheader()
    for i,r in enumerate(out,1): r['Rank']=i; w.writerow(r)

import collections
print("SEGMENTS:", dict(collections.Counter(r['Segment'] for r in out)))
print()
for s in ["Core (best fit)","Small","Enterprise / chain","Micro / owner-operated","Unknown"]:
    g=[r for r in out if r['Segment']==s]
    print(f"--- {s} ({len(g)}) ---")
    for r in g[:20]:
        print(f"   {str(r['Employees']):>4}emp  {r['Business'][:38]:40s} {r['Apollo city'] or r['City']:24s} {r['Coverage gap']}")
