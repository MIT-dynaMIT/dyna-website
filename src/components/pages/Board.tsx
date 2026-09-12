import React, { useEffect, useState } from "react";
import BoardMember from "../modules/BoardMember";
import formResponsesCsv from "../../assets/board_info.csv";
import Papa from "papaparse";
import { boardAppLink, openBoardApps } from "../../utils";

interface BoardMemberData {
  "First Name": string;
  "Last Name": string;
  Emojis: string;
  "Preferred Name": string;
  Year: string;
  Major: string;
  Hobbies: string;
  "Favorite STEM Experiment": string;
  "Fun Fact": string;
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
          transformHeader: (header) => header.trim(),
        });

        const members = data.map((row) => ({
          "First Name": row["First Name"] || "",
          "Last Name": row["Last Name"] || "",
          "Preferred Name": row["Preferred Name"] || "",
          Year: row["Year"] || "",
          Major: row["Major"] || "",
          Hobbies: row["Hobbies"] || "",
          "Favorite STEM Experiment": row["Favorite STEM Experiment"] || "",
          "Fun Fact": row["Fun Fact"] || "",
          Pronouns: row["Pronouns"] || "",
          Emojis: row["Emojis"],
        }));
        setBoardMembers(members);
      } catch (error) {
        console.error("Error loading board members:", error);
      }
    };

    fetchBoardMembers();
  }, []);

  return (
    <>
      {openBoardApps && (
        <div className="mb-16 rounded-2xl bg-white p-7 shadow-card ring-1 ring-dark/5 sm:p-8">
          <div className="flex flex-col gap-6 text-left sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="mb-2 font-display text-2xl font-bold text-dark">
                Join the Board
              </h2>
              <p className="max-w-2xl leading-relaxed text-dark/80">
                Board applications are open! We're the MIT students who run
                dynaMIT year-round — curriculum, outreach, funding, and camp
                itself. No prior experience necessary.
              </p>
            </div>
            <a
              href={boardAppLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center self-start rounded-lg bg-primary px-5 py-3 font-semibold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:self-auto"
            >
              Apply to the Board
            </a>
          </div>
        </div>
      )}

      <h1 className="mb-12 text-center font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
        Meet Our Board
      </h1>
      <div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {boardMembers.map((member, index) => {
            const displayName = `${member["First Name"]} ${
              member["Preferred Name"] ? `(${member["Preferred Name"]})` : ""
            } ${member["Last Name"]}`;
            const fileName = `${member["First Name"].toLowerCase()} ${member[
              "Last Name"
            ].toLowerCase()}.jpg`.replace(/ /g, "-");
            const imagePath = `/images_${member.Year}s/${fileName}`;
            console.log(imagePath);

            return (
              <BoardMember
                key={index}
                name={displayName}
                emojis={member.Emojis}
                year={member.Year}
                major={member.Major}
                hobbies={member.Hobbies}
                favoriteExperiment={member["Favorite STEM Experiment"]}
                funFact={member["Fun Fact"]}
                pronouns={member.Pronouns}
                imagePath={imagePath}
              />
            );
          })}
        </div>
      </div>
    </>
  );
};

export default Board;
