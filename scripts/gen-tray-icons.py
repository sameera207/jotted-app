# Regenerates the menu bar glyphs (black on transparent, so macOS can recolour them).
# Run from the repo root: python3 scripts/gen-tray-icons.py   (needs Pillow)
from PIL import Image, ImageDraw
import math
S=8; N=44; W=N*S
def base():
    im=Image.new("RGBA",(W,W),(0,0,0,0)); return im, ImageDraw.Draw(im)
def checklist(d, shift=0):
    k=S
    lw=int(2.6*k)
    # three rows: check/dot + line
    for i,y in enumerate((11,22,33)):
        cy=y*k
        if i==0:
            d.line([(7*k,cy),(10*k,cy+3*k),(15*k,cy-4*k)],fill="black",width=lw,joint="curve")
        else:
            r=int(2.2*k); d.ellipse([11*k-r,cy-r,11*k+r,cy+r],fill="black")
        d.line([(20*k,cy),(37*k,cy)],fill="black",width=lw)
        for x in (20*k,37*k):
            d.ellipse([x-lw//2,cy-lw//2,x+lw//2,cy+lw//2],fill="black")
def out(im,name):
    im.resize((N,N),Image.LANCZOS).save(name)
im,d=base(); checklist(d); out(im,"src-tauri/icons/tray/idle.png")
# syncing: refresh arc ring
im,d=base(); k=S; lw=int(3.2*k); c=22*k; r=14*k
d.arc([c-r,c-r,c+r,c+r],start=30,end=300,fill="black",width=lw)
for ang in (30,300):
    a=math.radians(ang); x=c+r*math.cos(a); y=c+r*math.sin(a)
    d.ellipse([x-lw/2,y-lw/2,x+lw/2,y+lw/2],fill="black")
a=math.radians(300); x=c+r*math.cos(a); y=c+r*math.sin(a)
d.polygon([(x-1*k,y-8*k),(x+8*k,y+1*k),(x-5*k,y+4*k)],fill="black")
out(im,"src-tauri/icons/tray/syncing.png")
# attention: checklist with badge in corner, rows shortened
im,d=base(); checklist(d)
cx,cy,r=35*k,35*k,9*k
d.ellipse([cx-r-2*k,cy-r-2*k,cx+r+2*k,cy+r+2*k],fill=(0,0,0,0))
im2=im.copy(); 
mask=Image.new("L",(W,W),0); ImageDraw.Draw(mask).ellipse([cx-r-2*k,cy-r-2*k,cx+r+2*k,cy+r+2*k],fill=255)
im.paste((0,0,0,0),mask=mask)
d=ImageDraw.Draw(im)
d.ellipse([cx-r,cy-r,cx+r,cy+r],fill="black")
d.line([(cx,cy-5*k),(cx,cy+1*k)],fill=(0,0,0,0),width=int(2.4*k))
d.ellipse([cx-1.3*k,cy+3*k,cx+1.3*k,cy+5.6*k],fill=(0,0,0,0))
# punch exclamation out of the badge
im_a=im.split()[3]
bm=Image.new("L",(W,W),0); bd=ImageDraw.Draw(bm)
bd.line([(cx,cy-5*k),(cx,cy+0.5*k)],fill=255,width=int(2.4*k))
bd.ellipse([cx-1.3*k,cy+3*k,cx+1.3*k,cy+5.6*k],fill=255)
im_a.paste(0,mask=bm); im.putalpha(im_a)
out(im,"src-tauri/icons/tray/attention.png")
