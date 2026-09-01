import { useEffect } from "react";
import { imgUrl } from "../utils/api";

const normalizeCastPerson = (person) => {
  if (Array.isArray(person.roles)) {
    return {
      ...person,
      characterList: person.roles.map((r) => r.character).filter(Boolean),
    };
  }

  return {
    ...person,
    characterList: person.character ? [person.character] : [],
  };
};

function normalizeCast(cast = []) {
  return cast.map(normalizeCastPerson);
}

const normalizeCrewPerson = (person) => {
  if (Array.isArray(person.jobs)) {
    return {
      ...person,
      jobList: person.jobs.map((j) => j.job),
    };
  }

  return {
    ...person,
    jobList: person.job ? [person.job] : [],
  };
};

const getDirectors = (crew = []) => {
  return crew
    .map(normalizeCrewPerson)
    .filter((person) => person.jobList.includes("Director"));
};

const getWriters = (crew = []) => {
  const writerJobs = ["Screenplay", "Writer", "Story", "Novel"];
  return crew
    .map(normalizeCrewPerson)
    .filter((person) => person.jobList.some((job) => writerJobs.includes(job)));
};

function PersonCard({ person }) {
  const subtitle =
    person.characterList?.join(", ") || person.jobList?.join(", ") || "";

  return (
    <div key={person.id} className="cast-person">
      {person.profile_path ? (
        <img
          src={imgUrl(person.profile_path, "w185")}
          alt={person.name}
          className="cast-person-photo"
          loading="lazy"
        />
      ) : (
        <div className="cast-person-photo cast-person-photo--fallback">
          {person.name?.[0] ?? "?"}
        </div>
      )}
      <div className="cast-person-name">{person.name}</div>
      <div className="cast-person-character">{subtitle}</div>
    </div>
  );
}

export default function CastModal({ onClose, cast, crew, title }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const directors = getDirectors(crew);
  const writers = getWriters(crew);
  const normalizedCast = normalizeCast(cast);

  return (
    <div className="cast-overlay" onClick={onClose}>
      <div className="cast-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cast-modal-header">
          <span className="cast-modal-title">🎭 Cast &amp; Crew — {title}</span>
          <button className="cast-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cast-modal-body">
          {directors?.length > 0 && (
            <div className="cast-section">
              <div className="cast-section-title">Directors</div>
              <div className="cast-grid">
                {directors.slice(0, 4).map((person) => (
                  <PersonCard
                    key={person.credit_id ?? person.id}
                    person={person}
                  />
                ))}
              </div>
            </div>
          )}

          {writers.length > 0 && (
            <div className="cast-section">
              <div className="cast-section-title">Writers</div>
              <div className="cast-grid">
                {writers.slice(0, 4).map((person) => (
                  <PersonCard
                    key={person.credit_id ?? person.id}
                    person={person}
                  />
                ))}
              </div>
            </div>
          )}

          {normalizedCast.length > 0 ? (
            <div className="cast-section">
              <div className="cast-section-title">Cast</div>
              <div className="cast-grid">
                {normalizedCast.slice(0, 20).map((person) => (
                  <PersonCard
                    key={person.credit_id ?? person.id}
                    person={person}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="cast-empty">No cast information available.</div>
          )}
        </div>
      </div>
    </div>
  );
}
