import React, { useEffect, useState } from 'react';
import BoardMember from '../modules/BoardMember';
import formResponsesCsv from '../../assets/form_responses.csv';
import Papa from 'papaparse';

interface BoardMemberData {
  Name: string;
  Year: string;
  Major: string;
  Hobbies: string;
  'Favorite STEM Experiment': string;
  'Fun Fact': string;
  Pronouns: string;
}

const Board: React.FC = () => {
  const [boardMembers, setBoardMembers] = useState<BoardMemberData[]>([]);

  useEffect(() => {
    const fetchBoardMembers = async () => {
      try {
        const response = await fetch(formResponsesCsv);
        const csvText = await response.text();
        
        // Parse CSV using papaparse
        const { data } = Papa.parse<BoardMemberData>(csvText, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim()
        });

        const members = data.map((row) => ({
          Name: row['Name'] || '',
          Year: row['Year'] || '',
          Major: row['Major'] || '',
          Hobbies: row['Hobbies'] || '',
          'Favorite STEM Experiment': row['Favorite STEM Experiment'] || '',
          'Fun Fact': row['Fun Fact'] || '',
          Pronouns: row['Pronouns'] || ''
        }));
        
        console.log('Parsed members:', members);
        setBoardMembers(members);
      } catch (error) {
        console.error('Error loading board members:', error);
      }
    };

    fetchBoardMembers();
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center text-primary-blue mb-8">
        Meet Our Board
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {boardMembers.map((member, index) => {
          console.log(`/images_${member.Year}s/${member.Name.toLowerCase().replace(' ', '_')}.jpg`);
          return <BoardMember
            key={index}
            name={member.Name}
            year={member.Year}
            major={member.Major}
            hobbies={member.Hobbies}
            favoriteExperiment={member['Favorite STEM Experiment']}
            funFact={member['Fun Fact']}
            pronouns={member.Pronouns}
            imagePath={`/images_${member.Year}s/${member.Name.toLowerCase().replace(' ', '-')}.jpg`}
          />
})}
      </div>
    </div>
  );
};

export default Board;
