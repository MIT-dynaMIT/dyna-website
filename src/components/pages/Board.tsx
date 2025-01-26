import React, { useEffect, useState } from 'react';
import BoardMember from '../modules/BoardMember';
import formResponsesCsv from '../../assets/board_info.csv';
import Papa from 'papaparse';

interface BoardMemberData {
  'First Name': string;
  'Last Name': string;
  'Preferred Name': string;
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
          'First Name': row['First Name'] || '',
          'Last Name': row['Last Name'] || '',
          'Preferred Name': row['Preferred Name'] || '',
          Year: row['Year'] || '',
          Major: row['Major'] || '',
          Hobbies: row['Hobbies'] || '',
          'Favorite STEM Experiment': row['Favorite STEM Experiment'] || '',
          'Fun Fact': row['Fun Fact'] || '',
          Pronouns: row['Pronouns'] || ''
        }));
        setBoardMembers(members);
      } catch (error) {
        console.error('Error loading board members:', error);
      }
    };

    fetchBoardMembers();
  }, []);

  return (
    <>
      <h1 className="mb-12 text-center text-4xl font-bold">Meet Our Board</h1>
      <div className="">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {boardMembers.map((member, index) => {
            const displayName = `${member['First Name']} ${member['Preferred Name'] ? `(${member['Preferred Name']})` : ''} ${member['Last Name']}`;
            const imagePath = `/images_${member.Year}s/${member['First Name'].toLowerCase()}-${member['Last Name'].toLowerCase()}.jpg`;
            
            return <BoardMember
              key={index}
              name={displayName}
              year={member.Year}
              major={member.Major}
              hobbies={member.Hobbies}
              favoriteExperiment={member['Favorite STEM Experiment']}
              funFact={member['Fun Fact']}
              pronouns={member.Pronouns}
              imagePath={imagePath}
            />
          })}
        </div>
      </div>
    </>
  );
};

export default Board;
