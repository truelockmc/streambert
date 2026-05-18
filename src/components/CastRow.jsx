import { memo, useCallback } from "react";
import PersonCard from "./PersonCard";

/**
 * Horizontal scrollable cast strip.
 * Shows top N cast members as PersonCards with name + character.
 *
 * Props:
 *   title         — section label (default: "Cast")
 *   credits       — array from /movie/{id}/credits or /tv/{id}/credits
 *   onPersonClick — (personItem) => void
 *   limit         — max cast members to show (default: 10)
 *   loading       — show skeleton state (default: false)
 */
const CastRow = memo(function CastRow({
  title = "Cast",
  credits = [],
  onPersonClick,
  limit = 10,
  loading = false,
}) {
  const handlePersonClick = useCallback(
    (item) => {
      // Normalize: TMDB cast has id, name, profile_path, character
      const personItem = {
        id: item.id,
        name: item.name,
        profile_path: item.profile_path,
        media_type: "person",
        known_for_department: item.known_for_department,
        character: item.character,
      };
      onPersonClick?.(personItem);
    },
    [onPersonClick],
  );

  if (loading) {
    return (
      <div className="section">
        <div className="section-title">{title}</div>
        <div className="scroll-row">
          {Array.from({ length: 6 }).map((_, i) => (
            <PersonCard
              key={i}
              loading
              size={80}
              showName
            />
          ))}
        </div>
      </div>
    );
  }

  const visible = credits.slice(0, limit);
  if (visible.length === 0) return null;

  return (
    <div className="section cast-section">
      <div className="section-title">{title}</div>
      <div className="scroll-row">
        {visible.map((member) => (
          <div
            key={member.cast_id ?? member.id}
            className="cast-member"
          >
            <PersonCard
              item={member}
              onClick={handlePersonClick}
              size={80}
              showName
            />
            <div className="cast-member-name">{member.name}</div>
            <div
              className="cast-member-character"
              title={member.character}
            >
              {member.character || ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default CastRow;