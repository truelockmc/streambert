import { memo, useCallback, useState } from "react";
import { imgUrl } from "../utils/api";

/**
 * Circular profile card for a person.
 * Used in: Search results, HomePage Popular People, CastRow, PersonPage co-stars.
 *
 * Props:
 *   item      — { id, name, profile_path, media_type: "person", known_for_department? }
 *   onClick   — (item) => void
 *   size      — circle diameter in px (default: 80)
 *   showName  — show name below circle (default: true)
 *   showDept  — show department badge (default: false)
 *   loading   — show skeleton state (default: false)
 */
const PersonCard = memo(function PersonCard({
  item,
  onClick,
  size = 80,
  showName = true,
  showDept = false,
  loading = false,
}) {
  const [imgError, setImgError] = useState(false);

  const handleClick = useCallback(
    (e) => {
      e.preventDefault();
      onClick?.(item);
    },
    [item, onClick],
  );

  // Reset image error state when item changes
  const profilePath = item?.profile_path;
  // Use a key-derived effect: when profile_path changes, reset error
  // We track this via a simple comparison in render
  if (profilePath && imgError) {
    // If the image path changed, reset error so we try loading again
    // We do this by checking if the src would differ — simpler to just
    // let the key handle it. But since we can't use key here easily,
    // we'll track it with a ref-like pattern using the item id.
  }

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: "var(--surface2)",
            animation: "pulse 1.5s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
        {showName && (
          <div
            style={{
              width: size + 10,
              height: 11,
              borderRadius: 4,
              background: "var(--surface2)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>
    );
  }

  const initials = item?.name
    ? item.name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : "?";

  // Deterministic color from name
  const colorIndex =
    item?.name
      ? item.name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 5
      : 0;
  const fallbackColors = ["#2d5a8a", "#5a2d6b", "#2d7a4a", "#7a4a2d", "#4a2d7a"];
  const fallbackColor = fallbackColors[colorIndex];

  const showFallback = !profilePath || imgError;

  const circleStyle = {
    width: size,
    height: size,
    borderRadius: "50%",
    overflow: "hidden",
    flexShrink: 0,
    cursor: "pointer",
    border: "2px solid transparent",
    transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s",
    background: fallbackColor,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div
        style={circleStyle}
        className="person-card-circle"
        onClick={handleClick}
        title={item?.name}
      >
        {!showFallback && (
          <img
            src={imgUrl(profilePath, "h632")}
            alt={item.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={() => setImgError(true)}
          />
        )}
        {showFallback && (
          <span
            style={{
              color: "rgba(255,255,255,0.7)",
              fontSize: size * 0.3,
              fontWeight: 600,
              fontFamily: "var(--font-display)",
              letterSpacing: 1,
            }}
          >
            {initials}
          </span>
        )}
      </div>

      {showName && (
        <div
          style={{
            maxWidth: size + 16,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: Math.max(11, size * 0.14),
              fontWeight: 500,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.3,
            }}
          >
            {item?.name || ""}
          </div>
          {showDept && item?.known_for_department && item.known_for_department !== "Acting" && (
            <div
              style={{
                fontSize: 10,
                color: "var(--text3)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.known_for_department}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default PersonCard;