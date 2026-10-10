import unittest
from datetime import date
from unittest.mock import patch
import update_data as u


class ChampionsDailyDownloadTests(unittest.TestCase):
    def test_reads_every_day_and_deduplicates_events(self):
        game = {'eventId': '1', 'date': '2026-09-08', 'time': '21:00'}
        with patch.object(u, 'get_scoreboard', side_effect=[[game], [game], []]) as read:
            result = u.get_scoreboard_range('Champions', date(2026, 9, 8), date(2026, 9, 10))
        self.assertEqual(result, [game])
        self.assertEqual([c.args[1] for c in read.call_args_list],
                         [date(2026, 9, 8), date(2026, 9, 9), date(2026, 9, 10)])

    def test_failed_day_does_not_return_partial_round(self):
        with patch.object(u, 'get_scoreboard', side_effect=[[], RuntimeError('offline')]):
            with self.assertRaises(RuntimeError):
                u.get_scoreboard_range('Champions', date(2026, 9, 8), date(2026, 9, 10))


if __name__ == '__main__':
    unittest.main()
