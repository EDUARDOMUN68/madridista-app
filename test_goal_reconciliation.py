import unittest
from copy import deepcopy

import update_data as updater


class OfficialResultRepairTests(unittest.TestCase):
    def setUp(self):
        self.fixture = {"competition": "LaLiga", "jornada": 5, "venue": "home",
                        "opponent": "Rayo Vallecano", "status": "finished",
                        "date": "2026-09-12", "time": "21:00", "score": "2–0",
                        "goalsVerified": True, "goalDetails": [],
                        "goalDetailsScore": "2–0", "goalDetailsCheckedAt": "2026-10-10T19:45+02:00"}
        self.match = {"competition": "LaLiga", "status": "finished", "home": "Real Madrid",
                      "away": "Rayo Vallecano", "score": "4–1", "date": "2026-09-12",
                      "time": "21:00", "officialSource": "LALIGA"}

    def repair(self, matches):
        data = {"jornadasAll": {"LaLiga": {"5": {"matches": matches}}}}
        return updater.reconcile_finished_laliga_dates([self.fixture], data)

    def test_official_correction_invalidates_details_and_retry_delay(self):
        self.assertEqual(self.repair([self.match] + [{} for _ in range(9)]), 1)
        self.assertEqual(self.fixture["score"], "4–1")
        for key in ("goalsVerified", "goalDetails", "goalDetailsScore", "goalDetailsCheckedAt"):
            self.assertNotIn(key, self.fixture)

    def test_unofficial_score_cannot_replace_history(self):
        self.match.pop("officialSource")
        self.repair([self.match] + [{} for _ in range(9)])
        self.assertEqual(self.fixture["score"], "2–0")

    def test_ambiguous_or_incomplete_round_cannot_replace_history(self):
        self.repair([self.match, deepcopy(self.match)] + [{} for _ in range(8)])
        self.repair([self.match])
        self.assertEqual(self.fixture["score"], "2–0")


if __name__ == "__main__":
    unittest.main()
