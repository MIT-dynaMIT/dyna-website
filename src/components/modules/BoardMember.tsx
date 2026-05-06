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
    <div className="m-4 flex max-w-sm flex-col items-center rounded-lg bg-white p-6 shadow-lg">
      <div className="mb-4 h-48 w-48 overflow-hidden rounded-full">
        {imagePath ? (
          <img
            src={imagePath}
            alt={`${name}'s profile`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-base">
            <span className="text-4xl text-dark">{name[0]}</span>
          </div>
        )}
      </div>

      <h3 className="text-primary-blue mb-1 text-xl font-bold">{name}</h3>
      <div className="flex gap-2">
        <p className="mb-1 text-dark">{pronouns}</p>
        <p className="mb-1 text-dark">{emojis}</p>
      </div>
      <p className="mb-2 text-dark">
        {major} '{year.substring(2)}
      </p>

      <div className="mt-2 w-full space-y-2">
        <div>
          <span className="font-semibold">Hobbies/Extracurriculars:</span>{" "}
          {hobbies}
        </div>
        {/* <div>
          <span className="font-semibold">Favorite STEM Experiment:</span> {favoriteExperiment}
        </div> */}
        <div>
          <span className="font-semibold">Fun Fact:</span> {funFact}
        </div>
      </div>
    </div>
  );
};

export default BoardMember;
