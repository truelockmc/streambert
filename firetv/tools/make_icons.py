"""Crisp Streambert launcher icon and Fire TV banner."""

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RED = (229, 9, 20, 255)
BLACK = (8, 8, 10, 255)
BOARD = (18, 18, 22, 255)
INK = (245, 245, 245, 255)
STRIPE = (12, 12, 14, 255)


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def clapper(canvas, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    hinge = int(h * 0.30)
    radius = int(w * 0.07)
    draw.rounded_rectangle((x0, y0 + int(h * 0.16), x1, y1), radius, fill=BOARD)
    draw.rounded_rectangle((x0, y0, x1, y0 + hinge + radius), radius, fill=RED)
    draw.rectangle((x0, y0 + hinge // 2, x1, y0 + hinge), fill=RED)

    stripes = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripes)
    gap = w / 5.2
    sw = gap * 0.42
    for i in range(-2, 8):
        cx = x0 + i * gap
        sd.polygon(
            [
                (cx, y0 - 20),
                (cx + sw, y0 - 20),
                (cx + sw - h * 0.55, y0 + hinge + 30),
                (cx - h * 0.55, y0 + hinge + 30),
            ],
            fill=STRIPE,
        )
    clip = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(clip).rounded_rectangle((x0, y0, x1, y0 + hinge), radius, fill=255)
    ImageDraw.Draw(clip).rectangle((x0, y0 + radius, x1, y0 + hinge), fill=255)
    stripes.putalpha(clip)
    layer.alpha_composite(stripes)

    # Mustache, two wings with a center dip.
    mx0 = x0 + w * 0.16
    mx1 = x1 - w * 0.16
    my = y0 + h * 0.62
    mw = (mx1 - mx0) / 2
    mh = h * 0.16
    left = (mx0, my - mh * 0.15, mx0 + mw * 1.08, my + mh)
    right = (mx1 - mw * 1.08, my - mh * 0.15, mx1, my + mh)
    ImageDraw.Draw(layer).pieslice(left, 200, 360, fill=INK)
    ImageDraw.Draw(layer).pieslice(right, 180, 340, fill=INK)
    curl_r = mh * 0.55
    ImageDraw.Draw(layer).ellipse(
        (mx0 - curl_r * 0.15, my + mh * 0.15, mx0 + curl_r, my + mh * 0.15 + curl_r),
        fill=INK,
    )
    ImageDraw.Draw(layer).ellipse(
        (mx1 - curl_r, my + mh * 0.15, mx1 + curl_r * 0.15, my + mh * 0.15 + curl_r),
        fill=INK,
    )
    canvas.alpha_composite(layer)


def icon(path):
    size = 512
    image = Image.new("RGBA", (size, size), BLACK)
    pad = 56
    clapper(image, (pad, pad + 8, size - pad, size - pad - 4))
    image.save(path)


def banner(path):
    w, h = 1280, 720
    image = Image.new("RGBA", (w, h), BLACK)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((40, 80, 620, 660), fill=(229, 9, 20, 42))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(70)))
    clapper(image, (150, 150, 560, 560))
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 92)
    draw = ImageDraw.Draw(image)
    draw.text((640, 300), "Streambert", font=font, fill=INK, anchor="lm")
    draw.rounded_rectangle((640, 390, 820, 402), 4, fill=RED)
    image.save(path)


if __name__ == "__main__":
    icon("/tmp/streambert-icon.png")
    banner("/tmp/streambert-banner.png")
