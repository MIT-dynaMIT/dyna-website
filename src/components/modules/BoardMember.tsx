import React from 'react';

interface BoardMemberProps {
  name: string;
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
  year,
  major,
  hobbies,
  favoriteExperiment,
  funFact,
  pronouns,
  imagePath
}) => {
  return (
    <div className="flex flex-col items-center p-6 bg-white rounded-lg shadow-lg m-4 max-w-sm">
      <div className="w-48 h-48 mb-4 overflow-hidden rounded-full">
        {imagePath ? (
          <img
            src={imagePath}
            alt={`${name}'s profile`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
            <span className="text-4xl text-gray-400">{name[0]}</span>
          </div>
        )}
      </div>
      
      <h3 className="text-xl font-bold text-primary-blue mb-1">{name}</h3>
      <p className="text-gray-600 mb-1">{pronouns}</p>
      <p className="text-gray-700 mb-2">{major} '{year.substring(2)}</p>
      
      <div className="w-full space-y-2 mt-2">
        <div>
          <span className="font-semibold">Hobbies:</span> {hobbies}
        </div>
        <div>
          <span className="font-semibold">Favorite STEM Experiment:</span> {favoriteExperiment}
        </div>
        <div>
          <span className="font-semibold">Fun Fact:</span> {funFact}
        </div>
      </div>
    </div>
  );
};

export default BoardMember;
