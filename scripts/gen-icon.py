from PIL import Image, ImageDraw, ImageFont
import math

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background: rounded rectangle with gradient-like effect
# Deep blue base (Recruit Agent brand color)
bg_color = (23, 50, 89)  # #173259
accent = (0, 102, 255)   # #0066ff
white = (255, 255, 255)
light_blue = (56, 189, 248)

# Draw rounded rect background
radius = 180
draw.rounded_rectangle([(0, 0), (SIZE - 1, SIZE - 1)], radius=radius, fill=bg_color)

# Accent gradient stripe at top
for i in range(200):
    alpha = int(255 * (1 - i / 200) * 0.3)
    color = (56, 189, 248, alpha)
    draw.line([(0, i), (SIZE, i)], fill=color)
# Re-apply rounded corners by masking
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([(0, 0), (SIZE - 1, SIZE - 1)], radius=radius, fill=255)
img.putalpha(mask)

# Draw a chat bubble icon
bubble_x, bubble_y = SIZE // 2, SIZE // 2 - 60
bubble_w, bubble_h = 340, 260

# Main bubble
draw.rounded_rectangle(
    [(bubble_x - bubble_w, bubble_y - bubble_h),
     (bubble_x + bubble_w, bubble_y + bubble_h)],
    radius=60,
    fill=white
)
# Bubble tail
tail_points = [
    (bubble_x - 60, bubble_y + bubble_h - 10),
    (bubble_x + 20, bubble_y + bubble_h - 10),
    (bubble_x - 100, bubble_y + bubble_h + 100),
]
draw.polygon(tail_points, fill=white)

# "Q&A" text in bubble
try:
    font_large = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 200)
    font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 80)
    font_jp = ImageFont.truetype("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", 72)
except:
    font_large = ImageFont.load_default()
    font_small = ImageFont.load_default()
    font_jp = ImageFont.load_default()

# Q&A text
draw.text((bubble_x, bubble_y - 40), "Q&A", fill=bg_color, font=font_large, anchor="mm")

# RAG label at bottom
draw.text((SIZE // 2, SIZE - 120), "RAG", fill=light_blue, font=font_small, anchor="mm")

# Search magnifying glass icon (top right of bubble)
glass_cx, glass_cy = bubble_x + 240, bubble_y - 180
glass_r = 70
draw.ellipse(
    [(glass_cx - glass_r, glass_cy - glass_r),
     (glass_cx + glass_r, glass_cy + glass_r)],
    outline=accent, width=12
)
# Handle
hx = glass_cx + int(glass_r * 0.7)
hy = glass_cy + int(glass_r * 0.7)
draw.line([(hx, hy), (hx + 50, hy + 50)], fill=accent, width=12)

# Small dots in bubble (typing indicator style)
dot_y = bubble_y + 100
for dx in [-80, 0, 80]:
    draw.ellipse(
        [(bubble_x + dx - 18, dot_y - 18),
         (bubble_x + dx + 18, dot_y + 18)],
        fill=(180, 200, 220)
    )

output_path = "/Users/naoya_yoshida2/Documents/slack-digest-tool/bot-icon.png"
img.save(output_path, "PNG")
print(f"Saved: {output_path} ({SIZE}x{SIZE})")
