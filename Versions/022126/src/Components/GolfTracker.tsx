import React, { useState, ChangeEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const NUM_HOLES = 18;

type Team = 'team1' | 'team2';

type Scores = {
  team1: string[];
  team2: string[];
};

const GolfScoreTracker: React.FC = () => {
  const [scores, setScores] = useState<Scores>({
    team1: Array(NUM_HOLES).fill(""),
    team2: Array(NUM_HOLES).fill(""),
  });

  const handleScoreChange = (
    team: Team,
    holeIndex: number,
    value: string
  ) => {
    const updatedScores = { ...scores };
    updatedScores[team][holeIndex] = value;
    setScores(updatedScores);
  };

  const calculateTotal = (team: Team): number => {
    return scores[team].reduce(
      (total, score) => total + (parseInt(score, 10) || 0),
      0
    );
  };

  return (
    <div className="p-6 grid grid-cols-1 gap-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-center">Scramble Golf Score Tracker</h1>
      <div className="grid grid-cols-2 gap-6">
        {["team1", "team2"].map((teamKey, idx) => {
          const team = teamKey as Team;
          return (
            <Card key={team}>
              <CardContent className="p-4">
                <h2 className="text-xl font-semibold mb-4">Team {idx + 1}</h2>
                <div className="grid grid-cols-2 gap-2">
                  {scores[team].map((score, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <label className="w-12">Hole {index + 1}</label>
                      <Input
                        type="number"
                        min="1"
                        value={score}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          handleScoreChange(team, index, e.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 font-bold">Total: {calculateTotal(team)}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default GolfScoreTracker;
