import React from "react";

interface BoardMemberProps {
  name: string;
  emojis: string;
  year: string;
  major: string;
  hobbies: string;
  favoriteExperiment: string;
  funFact: string;
  pronouns: string;
  imagePath?: string;
}

const BoardMember: React.FC<BoardMemberProps> = ({
  name,
  emojis,
  year,
  major,
  hobbies,
  // favoriteExperiment,
  funFact,
  pronouns,
  imagePath,
}) => {
  return (
    <div className="flex h-full flex-col items-center rounded-2xl bg-white p-6 text-center ring-1 ring-dark/5 shadow-card">
      <div className="mb-4 h-44 w-44 overflow-hidden rounded-full">
        {imagePath ? (
          <img
            src={imagePath}
            alt={`${name}'s profile`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-base to-accent">
            <span className="text-5xl font-bold text-dark/60">{name[0]}</span>
          </div>
        )}
      </div>

      <h3 className="mb-1 font-display text-xl font-bold text-dark">{name}</h3>
      <div className="mb-1 flex items-center justify-center gap-2 text-sm text-dark/70">
        <span>{pronouns}</span>
        {emojis && <span aria-hidden="true">{emojis}</span>}
      </div>
      <p className="mb-4 text-sm font-medium text-primary">
        {major} '{year.substring(2)}
      </p>

      <div className="mt-auto w-full space-y-3 border-t border-dark/5 pt-4 text-left text-sm text-dark/80">
        <div>
          <span className="font-semibold text-dark">Hobbies:</span>{" "}
          {hobbies}
        </div>
        <div>
          <span className="font-semibold text-dark">Fun Fact:</span> {funFact}
        </div>
      </div>
    </div>
  );
};

export default BoardMember;
