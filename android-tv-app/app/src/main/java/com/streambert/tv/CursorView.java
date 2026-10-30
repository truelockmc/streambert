package com.streambert.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;

/** Virtual pointer for the player's pointer mode, moved with the D-pad. */
final class CursorView extends View {
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float radius;
    private float x;
    private float y;

    CursorView(Context context) {
        super(context);
        float density = context.getResources().getDisplayMetrics().density;
        radius = 9 * density;
        fill.setColor(Color.WHITE);
        ring.setColor(0xFFE50914);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(3 * density);
        setFocusable(false);
        setClickable(false);
    }

    float getCursorX() {
        return x;
    }

    float getCursorY() {
        return y;
    }

    void center(int width, int height) {
        x = width / 2f;
        y = height / 2f;
        invalidate();
    }

    void moveBy(int dx, int dy, int width, int height) {
        x = Math.max(0, Math.min(width - 1, x + dx));
        y = Math.max(0, Math.min(height - 1, y + dy));
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        canvas.drawCircle(x, y, radius, fill);
        canvas.drawCircle(x, y, radius, ring);
    }
}
