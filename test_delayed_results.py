import unittest
from unittest.mock import patch
import update_data as u


class DelayedResultsTests(unittest.TestCase):
    def test_saved_round_is_refreshed_when_official_page_is_unavailable(self):
        match = {'competition': 'LaLiga', 'home': 'Real Madrid', 'away': 'Villarreal',
                 'date': '2026-10-10', 'displayDate': 'Sáb. 10 octubre', 'time': '21:00', 'status': 'scheduled',
                 'score': '0–0', 'officialSource': 'LALIGA'}
        finished = dict(match, status='finished', score='1–0', eventId='401882848')
        data = {'fixtures': [], 'jornadasCatalogMeta': {'sourceVersion': 4},
                'jornadasAll': {'LaLiga': {str(n): {'matches': [dict(match) for _ in range(10)]}
                                         for n in range(1, 39)}}}
        with patch.object(u, 'get_laliga_official_round_matches', return_value=None), \
             patch.object(u, 'get_scoreboard', return_value=[finished]), \
             patch.object(u, 'build_specific_jornada_payload', return_value=None), \
             patch.object(u, 'log'):
            u.refresh_jornadas_catalog(data)
        result = data['jornadasAll']['LaLiga']['8']['matches'][0]
        self.assertEqual((result['status'], result['score']), ('finished', '1–0'))
        fixture = {'competition': 'LaLiga', 'opponent': 'Villarreal CF', 'date': '2026-10-10',
                   'venue': 'home', 'status': 'scheduled', 'score': None, 'tv': ['Movistar']}
        u.merge_schedule([fixture], [u.madrid_event(result)])
        self.assertEqual((fixture['status'], fixture['score']), ('finished', '1–0'))
        self.assertEqual(fixture['tv'], ['Movistar'])


if __name__ == '__main__':
    unittest.main()
