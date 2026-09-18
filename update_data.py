#!/usr/bin/env python3
"""
Madridista · actualización automática con directo y clasificación provisional.

Modos:
- Normal (cada hora): revisa calendario, resultados, clasificaciones oficiales y
  prepara las ventanas de seguimiento y la Jornada completa de Liga/Champions.
- --live-only (cada 5 min): solo trabaja si estamos dentro de una ventana de
  partido. Actualiza marcadores en directo y calcula clasificaciones provisionales.

Fuente: endpoints públicos de ESPN. No necesita claves ni secretos.
La TV española se conserva del JSON existente.
"""
from __future__ import annotations

import argparse
import html as html_module
import json
import re
import sys
import unicodedata
from copy import deepcopy
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT / "real_madrid.json"
TEAM_ID = "86"
TZ = ZoneInfo("Europe/Madrid")

URLS = {
    "laliga_schedule": "https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams/86/schedule?season=2026",
    "champions_schedule": "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/teams/86/schedule?season=2026",
    "laliga_standings": "https://site.api.espn.com/apis/v2/sports/soccer/esp.1/standings?season=2026",
    "champions_standings": "https://site.api.espn.com/apis/v2/sports/soccer/uefa.champions/standings?season=2026",
}
LEAGUE_SLUGS = {"LaLiga": "esp.1", "Champions": "uefa.champions"}
LALIGA_NEXT_URL = "https://www.laliga.com/clubes/real-madrid/proximos-partidos"
REAL_MADRID_FIXTURES_URL = "https://www.realmadrid.com/es-ES/futbol/primer-equipo-masculino/inicio"
LALIGA_ROUND_URL = "https://www.laliga.com/laliga-easports/resultados/2026-27/jornada-{jornada}"
_LALIGA_ROUND_WINDOW_CACHE: dict[int, tuple[date, date] | None] = {}
_LALIGA_ROUND_MATCHES_CACHE: dict[int, list[dict] | None] = {}
_LALIGA_ROUND_DATES_CACHE: dict[int, tuple[date, ...] | None] = {}
KNOWN_TV = ("Movistar LALIGA", "Movistar Plus+", "Orange Fútbol 1", "Orange TV", "DAZN")

BASELINE_RESULTS = [
    {"competition": "LaLiga", "date": "2026-08-22", "opponent": "RCD Espanyol", "venue": "away", "score": "1–2"},
    {"competition": "LaLiga", "date": "2026-08-26", "opponent": "Real Sociedad", "venue": "home", "score": "4–1"},
    {"competition": "LaLiga", "date": "2026-08-30", "opponent": "Málaga CF", "venue": "home", "score": "4–0"},
]

MONTHS_ES = {1:"enero",2:"febrero",3:"marzo",4:"abril",5:"mayo",6:"junio",7:"julio",8:"agosto",9:"septiembre",10:"octubre",11:"noviembre",12:"diciembre"}
WEEKDAYS_ES = {0:"Lun.",1:"Mar.",2:"Mié.",3:"Jue.",4:"Vie.",5:"Sáb.",6:"Dom."}
NAME_ALIASES = {
    "inter milan":"inter de milan","internazionale":"inter de milan","internazionale milano":"inter de milan",
    "as roma":"roma","aek athens":"aek atenas","aek athens fc":"aek atenas","psv eindhoven":"psv",
    "lask linz":"lask","racing santander":"racing de santander","deportivo la coruna":"rc deportivo",
    "deportivo de la coruna":"rc deportivo","deportivo":"rc deportivo","espanyol":"rcd espanyol",
    "malaga":"malaga cf","athletic bilbao":"athletic club","alaves":"deportivo alaves","celta vigo":"celta",
    "barcelona":"fc barcelona","atletico madrid":"atletico de madrid","atletico de madrid":"atletico de madrid",
}


def log(msg: str) -> None:
    print(f"[Madridista] {msg}")


def fetch_json(url: str) -> dict:
    req = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; MadridistaUpdater/3.0; +https://github.com/)",
        "Accept": "application/json,text/plain,*/*",
    })
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str) -> str:
    req = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; MadridistaUpdater/3.0; +https://github.com/)",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "es-ES,es;q=0.9",
    })
    with urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def _strip_html_for_schedule(raw: str) -> str:
    raw = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", raw)
    raw = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", raw)
    raw = re.sub(r"(?i)</(?:tr|li|p|section|article|div)>", "\n", raw)
    raw = re.sub(r"(?i)</(?:td|th)>", " | ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    raw = html_module.unescape(raw)
    raw = raw.replace("\xa0", " ")
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r"\n+", "\n", raw)
    return raw


def get_laliga_official_schedule() -> list[dict]:
    """Best-effort reader of the official LALIGA Real Madrid schedule page.

    This source is especially useful for newly confirmed dates, kick-off times and
    Spanish broadcasters. If the page layout changes, the caller simply falls back
    to ESPN and preserves the TV data already present in the JSON.
    """
    text = _strip_html_for_schedule(fetch_text(LALIGA_NEXT_URL))
    # Keep the relevant section only when the labels are present.
    start = text.find("Calendario y próximos partidos del Real Madrid")
    if start >= 0:
        text = text[start:]
    # Normalize weekday accents to make the regex tolerant.
    weekday = r"(?:LUN|MAR|MIE|MIÉ|JUE|VIE|SAB|SÁB|DOM)"
    pat = re.compile(
        rf"{weekday}\s+(\d{{2}}\.\d{{2}}\.\d{{4}})\s*\|?\s*"
        rf"(\d{{2}}:\d{{2}}|--\s*:\s*--)\s*\|?\s*"
        rf"(.{{0,160}}?)\s+VS\s+(.{{0,160}}?)\s*\|?\s*LALIGA EA SPORTS\s*\|?\s*"
        rf"(.{{0,120}}?)(?=\n|{weekday}\s+\d{{2}}\.\d{{2}}\.\d{{4}}|$)",
        re.I,
    )
    out = []
    for m in pat.finditer(text):
        date_s, time_s, home, away, operator = [re.sub(r"\s+", " ", x).strip(" |-") for x in m.groups()]
        if not (same_team(home, "Real Madrid") or same_team(away, "Real Madrid")):
            continue
        try:
            dt = datetime.strptime(date_s, "%d.%m.%Y").replace(tzinfo=TZ)
        except Exception:
            continue
        confirmed_time = None if "--" in time_s else valid_time(time_s)
        venue = "home" if same_team(home, "Real Madrid") else "away"
        opponent = away if venue == "home" else home
        tv = [name for name in KNOWN_TV if name.lower() in operator.lower()]
        out.append({
            "competition": "LaLiga",
            "date": dt.date().isoformat(),
            "displayDate": display_date(dt),
            "time": confirmed_time,
            "venue": venue,
            "opponent": opponent,
            "tv": tv,
        })
    return out



_MONTHS_RM = {
    "ene": 1, "enero": 1, "feb": 2, "febrero": 2, "mar": 3, "marzo": 3,
    "abr": 4, "abril": 4, "may": 5, "mayo": 5, "jun": 6, "junio": 6,
    "jul": 7, "julio": 7, "ago": 8, "agosto": 8, "sep": 9, "sept": 9,
    "septiembre": 9, "oct": 10, "octubre": 10, "nov": 11, "noviembre": 11,
    "dic": 12, "diciembre": 12,
}


def _official_block_contains_team(block: str, team: str) -> bool:
    """Comprobación tolerante del rival dentro del bloque oficial del Real Madrid."""
    nb = normalize_name(block)
    nt = normalize_name(team)
    if not nt:
        return False
    if nt in nb:
        return True
    words = [w for w in nt.split() if len(w) >= 4]
    return bool(words) and sum(1 for w in words if w in nb) >= max(1, len(words) - 1)


def get_real_madrid_official_laliga_schedule(fixtures: list[dict]) -> list[dict]:
    """Lee la web oficial del Real Madrid y confirma fechas/horas de LaLiga.

    Se usa como segunda fuente oficial. La idea importante es que una hora futura
    solo se considere confirmada si aparece en LALIGA o en realmadrid.com. Si la
    web del club indica "fecha y hora por confirmar", devolvemos time=None para
    borrar cualquier hora provisional heredada de ESPN.
    """
    text = _strip_html_for_schedule(fetch_text(REAL_MADRID_FIXTURES_URL))
    out: list[dict] = []
    date_re = re.compile(
        r"(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)?\s*,?\s*"
        r"(\d{1,2})\s+"
        r"(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|"
        r"jul(?:io)?|ago(?:sto)?|sep(?:t)?(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)"
        r"(?:\s*,?\s*(\d{1,2}:\d{2})\s*h)?",
        re.I,
    )

    for fx in fixtures:
        if fx.get("competition") != "LaLiga" or not fx.get("jornada"):
            continue
        try:
            jornada = int(fx["jornada"])
        except Exception:
            continue
        jm = None
        block = ""
        for candidate in re.finditer(rf"Jornada\s+{jornada}\b", text, re.I):
            candidate_block = text[max(0, candidate.start() - 900): candidate.end() + 900]
            if _official_block_contains_team(candidate_block, fx.get("opponent", "")):
                jm = candidate
                block = candidate_block
                break
        if jm is None:
            continue

        # Priorizamos la fecha que aparece después del rótulo de jornada.
        after = text[jm.end(): jm.end() + 700]
        dm = date_re.search(after) or date_re.search(block)
        if not dm:
            continue
        day_s, month_s, time_s = dm.groups()
        month_key = normalize_name(month_s).replace(" ", "")
        month = _MONTHS_RM.get(month_key)
        if not month:
            # abreviaturas como "sept" o "sep"
            month = _MONTHS_RM.get(month_key[:4]) or _MONTHS_RM.get(month_key[:3])
        if not month:
            continue

        try:
            base_year = date.fromisoformat(fx.get("date", "")).year
        except Exception:
            base_year = datetime.now(TZ).year
        try:
            dt = datetime(base_year, month, int(day_s), tzinfo=TZ)
        except Exception:
            continue

        # Si la web oficial publica una hora válida, queda confirmada. Si solo
        # aparece la fecha (por ejemplo, "fecha y hora por confirmar"), time=None.
        confirmed_time = valid_time(time_s)
        out.append({
            "competition": "LaLiga",
            "jornada": jornada,
            "date": dt.date().isoformat(),
            "displayDate": display_date(dt),
            "time": confirmed_time,
            "venue": fx.get("venue"),
            "opponent": fx.get("opponent"),
            "tv": deepcopy(fx.get("tv") or []),
            "officialSource": "Real Madrid",
        })
    return out

def normalize_name(value: str | None) -> str:
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in value if not unicodedata.combining(c)).lower().replace("&", " y ")
    value = re.sub(r"\b(fc|cf|club de futbol|football club)\b", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return NAME_ALIASES.get(value, value)


def same_team(a: str, b: str) -> bool:
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    if na == nb or na in nb or nb in na:
        return True
    return SequenceMatcher(None, na, nb).ratio() >= 0.72


def parse_iso(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(TZ)


def display_date(dt: datetime) -> str:
    return f"{WEEKDAYS_ES[dt.weekday()]} {dt.day} {MONTHS_ES[dt.month]}"


def score_number(comp: dict) -> int | None:
    score = comp.get("score")
    if isinstance(score, dict):
        value = score.get("value", score.get("displayValue"))
    else:
        value = score
    try:
        return int(float(value))
    except Exception:
        return None



def valid_time(value: str | None) -> str | None:
    if not value:
        return None
    value = str(value).strip()
    return value if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value) else None

def translate_live_label(status: dict) -> str:
    stype = status.get("type") or {}
    detail = stype.get("shortDetail") or stype.get("detail") or ""
    clock = status.get("displayClock") or ""
    raw = (detail or clock or "En juego").strip()
    low = raw.lower()
    if "half" in low and ("time" in low or "halftime" in low):
        return "Descanso"
    if low in {"in progress", "live", "en juego"}:
        raw = clock or "En juego"
    # ESPN suele dar 72:15; para fútbol mostramos 72'.
    m = re.match(r"^(\d{1,3}):\d{2}$", str(raw))
    if m:
        return f"{int(m.group(1))}'"
    if raw.isdigit():
        return f"{raw}'"
    replacements = {
        "1st half":"1ª parte", "2nd half":"2ª parte", "extra time":"Prórroga",
        "penalties":"Penaltis", "delayed":"Retrasado",
    }
    return replacements.get(low, raw)


def generic_event(evt: dict, competition_name: str) -> dict | None:
    comps = evt.get("competitions") or []
    if not comps:
        return None
    comp = comps[0]
    competitors = comp.get("competitors") or []
    if len(competitors) < 2:
        return None

    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None

    dt = parse_iso(evt["date"])
    status = evt.get("status") or {}
    stype = status.get("type") or {}
    completed = bool(stype.get("completed"))
    state = stype.get("state")
    detail = str(stype.get("shortDetail") or stype.get("detail") or "").lower()
    if re.search(r"postpon|aplaz|cancel|abandon|suspend", detail):
        match_status = "postponed"
    else:
        match_status = "finished" if completed else ("live" if state == "in" else "scheduled")

    home_team = home.get("team") or {}
    away_team = away.get("team") or {}
    hs, aws = score_number(home), score_number(away)

    return {
        "eventId": str(evt.get("id", "")),
        "competition": competition_name,
        "date": dt.date().isoformat(),
        "displayDate": display_date(dt),
        "time": valid_time(dt.strftime("%H:%M")),
        "kickoff": dt.isoformat(timespec="minutes"),
        "home": home_team.get("displayName") or home_team.get("name") or "Local",
        "away": away_team.get("displayName") or away_team.get("name") or "Visitante",
        "homeScore": hs,
        "awayScore": aws,
        "score": f"{hs}–{aws}" if hs is not None and aws is not None else None,
        "status": match_status,
        "liveLabel": translate_live_label(status) if match_status == "live" else None,
    }


def madrid_event(item: dict) -> dict | None:
    if same_team(item["home"], "Real Madrid"):
        return {
            "competition": item["competition"], "date": item["date"], "displayDate": item["displayDate"],
            "time": item["time"], "venue": "home", "opponent": item["away"], "status": item["status"],
            "score": item["score"], "liveLabel": item.get("liveLabel"),
        }
    if same_team(item["away"], "Real Madrid"):
        return {
            "competition": item["competition"], "date": item["date"], "displayDate": item["displayDate"],
            "time": item["time"], "venue": "away", "opponent": item["home"], "status": item["status"],
            "score": item["score"], "liveLabel": item.get("liveLabel"),
        }
    return None


def get_team_schedule(url: str, competition_name: str) -> list[dict]:
    payload = fetch_json(url)
    out = []
    for evt in payload.get("events") or []:
        item = generic_event(evt, competition_name)
        if item:
            rm = madrid_event(item)
            if rm:
                out.append(rm)
    return out


def scoreboard_url(competition: str, day: date) -> str:
    return f"https://site.api.espn.com/apis/site/v2/sports/soccer/{LEAGUE_SLUGS[competition]}/scoreboard?dates={day.strftime('%Y%m%d')}"


def get_scoreboard(competition: str, day: date) -> list[dict]:
    payload = fetch_json(scoreboard_url(competition, day))
    result = []
    for evt in payload.get("events") or []:
        item = generic_event(evt, competition)
        if item:
            result.append(item)
    return result


def get_scoreboard_range(competition: str, start_day: date, end_day: date) -> list[dict]:
    start_s = start_day.strftime("%Y%m%d")
    end_s = end_day.strftime("%Y%m%d")
    dates = start_s if start_s == end_s else f"{start_s}-{end_s}"
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{LEAGUE_SLUGS[competition]}/scoreboard?dates={dates}&limit=200"
    payload = fetch_json(url)
    out = []
    for evt in payload.get("events") or []:
        item = generic_event(evt, competition)
        if item:
            out.append(item)
    out.sort(key=lambda x: (x.get("date") or "9999-99-99", x.get("time") or "99:99"))
    return out


def jornada_anchors(fixtures: list[dict], competition: str) -> list[dict]:
    by_round = {}
    for fx in fixtures:
        if fx.get("competition") != competition or not fx.get("date"):
            continue
        try:
            jornada = int(fx.get("jornada"))
        except Exception:
            continue
        by_round.setdefault(jornada, {"jornada": jornada, "date": date.fromisoformat(fx["date"])})
    return [by_round[k] for k in sorted(by_round)]


def jornada_window(fixtures: list[dict], competition: str, jornada: int) -> tuple[date, date] | None:
    anchors = jornada_anchors(fixtures, competition)
    idx = next((i for i, x in enumerate(anchors) if x["jornada"] == int(jornada)), None)
    if idx is None:
        return None
    cur = anchors[idx]["date"].toordinal()
    prev = anchors[idx - 1]["date"].toordinal() if idx > 0 else None
    nxt = anchors[idx + 1]["date"].toordinal() if idx < len(anchors) - 1 else None
    start_ord = cur - 4 if prev is None else (prev + cur) // 2 + 1
    end_ord = cur + 4 if nxt is None else (cur + nxt) // 2
    if competition == "Champions":
        start_ord = max(start_ord, cur - 2)
        end_ord = min(end_ord, cur + 2)
    return date.fromordinal(start_ord), date.fromordinal(end_ord)



def get_laliga_official_round_dates(jornada: int) -> tuple[date, ...] | None:
    """Devuelve las fechas EXACTAS que pertenecen a una jornada de LALIGA.

    No usamos un rango continuo porque una jornada puede tener un partido
    adelantado o aplazado muchos días. J6 2026/27, por ejemplo, contiene un
    Real Sociedad-Celta jugado el 3 de septiembre y el resto del 15 al 17.
    Un rango 03-17 mezclaría por error todos los partidos de la J5.
    """
    try:
        jornada = int(jornada)
    except Exception:
        return None
    if jornada in _LALIGA_ROUND_DATES_CACHE:
        return _LALIGA_ROUND_DATES_CACHE[jornada]

    try:
        text = _strip_html_for_schedule(fetch_text(LALIGA_ROUND_URL.format(jornada=jornada)))
        m = re.search(rf"JORNADA\s+{jornada}\b", text, re.I)
        if not m:
            _LALIGA_ROUND_DATES_CACHE[jornada] = None
            return None
        section = text[m.start():]
        end = re.search(rf"¿?Cuál es la jornada\s+{jornada}\b|Dónde ver la jornada\s+{jornada}\b", section, re.I)
        if end:
            section = section[:end.start()]
        found = []
        for ds in re.findall(r"\b(\d{2}\.\d{2}\.\d{4})\b", section):
            try:
                found.append(datetime.strptime(ds, "%d.%m.%Y").date())
            except Exception:
                pass
        dates = tuple(sorted(set(found)))
        _LALIGA_ROUND_DATES_CACHE[jornada] = dates or None
        return dates or None
    except Exception as exc:
        log(f"AVISO fechas oficiales LALIGA J{jornada}: {exc}")
        _LALIGA_ROUND_DATES_CACHE[jornada] = None
        return None


def get_laliga_official_round_window(jornada: int) -> tuple[date, date] | None:
    if jornada in _LALIGA_ROUND_WINDOW_CACHE:
        return _LALIGA_ROUND_WINDOW_CACHE[jornada]

    # Para decidir si una jornada sigue activa, ignoramos los partidos
    # aplazados/reprogramados aunque ya tengan nueva fecha. Así J6 no queda abierta
    # hasta octubre por un Levante-Athletic trasladado de fecha.
    matches = get_laliga_official_round_matches(jornada)
    if matches:
        normal_dates = []
        for m in matches:
            if m.get("status") == "postponed":
                continue
            try:
                normal_dates.append(date.fromisoformat(m.get("date", "")))
            except Exception:
                pass
        if normal_dates:
            window = (min(normal_dates), max(normal_dates))
            _LALIGA_ROUND_WINDOW_CACHE[jornada] = window
            return window

    dates = get_laliga_official_round_dates(jornada)
    if not dates:
        return None
    window = (dates[0], dates[-1])
    _LALIGA_ROUND_WINDOW_CACHE[jornada] = window
    return window


def get_jornada_matches(fixtures: list[dict], competition: str, jornada: int) -> tuple[list[dict], tuple[date, date] | None]:
    """Carga solo los partidos que pertenecen a la jornada indicada.

    Para LALIGA consulta únicamente las fechas oficiales de esa jornada, una a
    una, para que un partido adelantado no arrastre encuentros de otras jornadas.
    Champions mantiene la ventana compacta alrededor de la fecha del Madrid.
    """
    if competition == "LaLiga":
        exact_dates = get_laliga_official_round_dates(jornada)
        if exact_dates:
            matches: list[dict] = []
            seen: set[str] = set()
            for day in exact_dates:
                for match in get_scoreboard(competition, day):
                    key = match.get("eventId") or f"{normalize_name(match.get('home'))}|{normalize_name(match.get('away'))}|{match.get('date')}"
                    if key in seen:
                        continue
                    seen.add(key)
                    matches.append(match)
            matches.sort(key=lambda x: (x.get("date") or "9999-99-99", x.get("time") or "99:99"))
            return matches, (exact_dates[0], exact_dates[-1])

    window = effective_jornada_window(fixtures, competition, jornada)
    if not window:
        return [], None
    return get_scoreboard_range(competition, window[0], window[1]), window


def _clean_laliga_team(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip(" |-\t")
    value = re.sub(r"^(?:Ver resumen|Ver partido)\s+", "", value, flags=re.I)
    return value.strip(" |-\t")


def _mark_reprogrammed_round_matches(matches: list[dict]) -> list[dict]:
    """Marca como aplazados/reprogramados los partidos futuros muy alejados del bloque normal.

    LALIGA mantiene el partido dentro de su jornada original aunque le asigne una fecha
    mucho más tarde. Para decidir si la jornada está cerrada, ese encuentro no debe
    contar como pendiente. Solo marcamos partidos aún no jugados; los adelantados ya
    finalizados se conservan como finalizados aunque también estén lejos del bloque.
    """
    if len(matches) < 4:
        return matches
    parsed = []
    for m in matches:
        try:
            parsed.append((date.fromisoformat(m.get("date", "")), m))
        except Exception:
            pass
    if len(parsed) < 4:
        return matches

    dates = sorted(d for d, _ in parsed)
    # Busca el bloque de hasta 5 días que contiene más partidos: normalmente es
    # el fin de semana/jornada principal. Un adelantado finalizado no molesta.
    best_start = dates[0]
    best_end = best_start + timedelta(days=4)
    best_count = -1
    for d in dates:
        end = d + timedelta(days=4)
        count = sum(1 for x in dates if d <= x <= end)
        if count > best_count:
            best_count, best_start, best_end = count, d, end

    for d, m in parsed:
        if m.get("status") == "scheduled" and (d < best_start - timedelta(days=7) or d > best_end + timedelta(days=7)):
            m["status"] = "postponed"
            m["rescheduled"] = True
    return matches


def get_laliga_official_round_matches(jornada: int) -> list[dict] | None:
    """Lee los 10 partidos exactos de una jornada desde LALIGA.

    A diferencia de una ventana de fechas, esto conserva partidos adelantados o
    reprogramados que pertenecen a la jornada (p. ej. uno jugado días antes).
    """
    try:
        jornada = int(jornada)
    except Exception:
        return None
    if jornada in _LALIGA_ROUND_MATCHES_CACHE:
        cached = _LALIGA_ROUND_MATCHES_CACHE[jornada]
        return deepcopy(cached) if cached else cached

    try:
        text = _strip_html_for_schedule(fetch_text(LALIGA_ROUND_URL.format(jornada=jornada)))
        m = re.search(rf"JORNADA\s+{jornada}\b", text, re.I)
        if not m:
            _LALIGA_ROUND_MATCHES_CACHE[jornada] = None
            return None
        section = text[m.start():]
        end = re.search(rf"¿?Cuál es la jornada\s+{jornada}\b|Dónde ver la jornada\s+{jornada}\b", section, re.I)
        if end:
            section = section[:end.start()]

        weekday = r"(?:LUN|MAR|MIE|MIÉ|JUE|VIE|SAB|SÁB|DOM)"
        row_re = re.compile(rf"{weekday}\s+(\d{{2}}\.\d{{2}}\.\d{{4}})\s*\|?\s*(\d{{2}}:\d{{2}}|--\s*:\s*--)(.*)", re.I)
        out = []
        for raw_line in section.splitlines():
            line = re.sub(r"\s+", " ", raw_line).strip()
            rm = row_re.search(line)
            if not rm:
                continue
            date_s, time_s, rest = rm.groups()
            try:
                dt = datetime.strptime(date_s, "%d.%m.%Y").replace(tzinfo=TZ)
            except Exception:
                continue

            # La celda PARTIDO queda separada por "|" tras _strip_html_for_schedule.
            cells = [re.sub(r"\s+", " ", c).strip() for c in rest.split("|") if c.strip()]
            match_cell = next((c for c in cells if re.search(r"\bVS\b", c, re.I) or re.search(r"\d+\s*-\s*\d+", c)), None)
            if not match_cell:
                match_cell = rest
            match_cell = re.sub(r"^(?:Ver resumen|Ver partido)\s+", "", match_cell, flags=re.I).strip()

            status = "scheduled"
            hs = aws = None
            home = away = None
            sm = re.match(r"(.+?)\s+(\d+)\s*-\s*(\d+)\s+(.+)$", match_cell)
            if sm:
                home, hs_s, aws_s, away = sm.groups()
                hs, aws = int(hs_s), int(aws_s)
                status = "finished"
            else:
                vm = re.match(r"(.+?)\s+VS\s+(.+)$", match_cell, re.I)
                if vm:
                    home, away = vm.groups()
            if not home or not away:
                continue

            home = _clean_laliga_team(home)
            away = _clean_laliga_team(away)
            # Elimina posibles restos de columnas posteriores si el HTML cambió.
            away = re.split(r"\s{2,}|\s+-\s+|\s+(?:Movistar|DAZN|Orange)\b", away, maxsplit=1, flags=re.I)[0].strip()
            if not home or not away:
                continue

            kickoff_time = None if "--" in time_s else valid_time(time_s)
            kickoff_dt = dt
            if kickoff_time:
                hh, mm = [int(x) for x in kickoff_time.split(":")]
                kickoff_dt = dt.replace(hour=hh, minute=mm)
            out.append({
                "eventId": "",
                "competition": "LaLiga",
                "date": dt.date().isoformat(),
                "displayDate": display_date(dt),
                "time": kickoff_time,
                "kickoff": kickoff_dt.isoformat(timespec="minutes"),
                "home": home,
                "away": away,
                "homeScore": hs,
                "awayScore": aws,
                "score": f"{hs}–{aws}" if hs is not None and aws is not None else None,
                "status": status,
                "liveLabel": None,
            })

        out = _mark_reprogrammed_round_matches(out)

        # Una jornada de Primera debe tener 10 partidos. Si el HTML cambia y no
        # obtenemos una lista razonable, preferimos caer al método anterior.
        if len(out) < 8:
            _LALIGA_ROUND_MATCHES_CACHE[jornada] = None
            return None
        out.sort(key=lambda x: (x.get("date") or "9999-99-99", x.get("time") or "99:99"))
        _LALIGA_ROUND_MATCHES_CACHE[jornada] = deepcopy(out)
        return out
    except Exception as exc:
        log(f"AVISO partidos oficiales LALIGA J{jornada}: {exc}")
        _LALIGA_ROUND_MATCHES_CACHE[jornada] = None
        return None


def overlay_today_round_status(matches: list[dict], competition: str, today: date) -> list[dict]:
    """Superpone estados reales en toda fecha pasada/actual aún no finalizada.

    La lista oficial de LALIGA define qué partidos pertenecen a la jornada. Para
    el estado (directo/final), consultamos hoy y cualquier fecha anterior que
    todavía figure como no finalizada. Así un minuto de directo del día anterior
    no puede quedar publicado durante horas o días.
    """
    out = deepcopy(matches)
    dates_to_refresh = {today}
    for m in out:
        try:
            d = date.fromisoformat(m.get("date", ""))
        except Exception:
            continue
        if d <= today and m.get("status") != "finished":
            dates_to_refresh.add(d)

    for day in sorted(dates_to_refresh):
        if not any(m.get("date") == day.isoformat() for m in out):
            continue
        try:
            fresh = get_scoreboard(competition, day)
        except Exception as exc:
            log(f"AVISO directo jornada {competition} {day}: {exc}")
            continue
        for m in out:
            if m.get("date") != day.isoformat():
                continue
            hit = next((g for g in fresh if same_team(m.get("home", ""), g.get("home", "")) and same_team(m.get("away", ""), g.get("away", ""))), None)
            if hit:
                for key in ("eventId", "status", "homeScore", "awayScore", "score", "liveLabel", "time", "kickoff", "displayDate"):
                    if hit.get(key) is not None:
                        m[key] = hit.get(key)
                if m.get("status") == "finished":
                    m.pop("liveLabel", None)

            # Blindaje de aplazados: un partido de una fecha YA pasada no puede
            # seguir figurando como "scheduled" indefinidamente. Algunas fuentes
            # conservan la fecha original incluso después de reprogramarlo. Si al
            # día siguiente sigue como programado (haya o no coincidencia en ESPN),
            # lo tratamos como aplazado para que NO bloquee el cierre de la jornada.
            # Si realmente se disputó, el estado fresh será live/finished y no entra.
            try:
                match_day = date.fromisoformat(m.get("date", ""))
            except Exception:
                match_day = None
            if match_day and match_day < today and m.get("status") == "scheduled":
                m["status"] = "postponed"
                m["rescheduled"] = True
                m.pop("liveLabel", None)
    return out


def _mark_expired_laliga_scheduled_as_postponed(matches: list[dict], today: date) -> list[dict]:
    """Blindaje final de cierre de jornada de LaLiga.

    Se aplica SIEMPRE, también cuando falla el lector de la página oficial y
    entramos por la ruta de respaldo. Un partido que conserva estado
    ``scheduled`` con una fecha anterior a hoy no puede mantener una jornada
    abierta indefinidamente: se trata como aplazado/reprogramado a efectos de
    Jornada. Si una fuente devuelve después ``live`` o ``finished``, esos estados
    tienen prioridad y no se tocan.
    """
    for m in matches:
        if m.get("status") != "scheduled":
            continue
        try:
            match_day = date.fromisoformat(m.get("date", ""))
        except Exception:
            continue
        if match_day < today:
            m["status"] = "postponed"
            m["rescheduled"] = True
            m.pop("liveLabel", None)
    return matches


def build_specific_jornada_payload(fixtures: list[dict], competition: str, jornada: int, today: date) -> dict | None:
    if competition == "LaLiga":
        official = get_laliga_official_round_matches(jornada)
        if official:
            matches = overlay_today_round_status(official, competition, today)
            dates = [date.fromisoformat(m["date"]) for m in matches if m.get("date")]
            window = (min(dates), max(dates)) if dates else None
        else:
            window = effective_jornada_window(fixtures, competition, jornada)
            if not window:
                return None
            matches = get_scoreboard_range(competition, window[0], window[1])
    else:
        window = effective_jornada_window(fixtures, competition, jornada)
        if not window:
            return None
        matches = get_scoreboard_range(competition, window[0], window[1])

    # IMPORTANTE: este blindaje va fuera de la rama "official" para que
    # también funcione si el HTML de LaLiga cambia y usamos el fallback.
    # Ese era el motivo por el que J6 seguía en 8/9: Levante-Athletic quedaba
    # "scheduled" en la ruta de respaldo y bloqueaba el salto de jornada.
    if competition == "LaLiga":
        matches = _mark_expired_laliga_scheduled_as_postponed(matches, today)

    normal = [m for m in matches if m.get("status") != "postponed"]
    return {
        "competition": competition,
        "jornada": int(jornada),
        "phase": jornada_phase(matches),
        "windowStart": window[0].isoformat() if window else None,
        "windowEnd": window[1].isoformat() if window else None,
        "finished": sum(1 for m in normal if m.get("status") == "finished"),
        "total": len(normal),
        "live": sum(1 for m in normal if m.get("status") == "live"),
        "postponed": sum(1 for m in matches if m.get("status") == "postponed"),
        "updatedAt": datetime.now(TZ).isoformat(timespec="minutes"),
        "matches": matches,
    }


def effective_jornada_window(fixtures: list[dict], competition: str, jornada: int) -> tuple[date, date] | None:
    if competition == "LaLiga":
        official = get_laliga_official_round_window(jornada)
        if official:
            return official
    return jornada_window(fixtures, competition, jornada)

def jornada_phase(matches: list[dict]) -> str:
    normal = [m for m in matches if m.get("status") != "postponed"]
    if not normal:
        return "upcoming"
    started = any(m.get("status") in {"live", "finished"} for m in normal)
    unfinished = any(m.get("status") != "finished" for m in normal)
    if started and unfinished:
        return "active"
    if all(m.get("status") == "finished" for m in normal):
        return "complete"
    return "upcoming"


def choose_jornada_candidate(fixtures: list[dict], competition: str, today: date) -> int | None:
    anchors = jornada_anchors(fixtures, competition)
    if not anchors:
        return None

    # Primera aproximación por el calendario del Madrid.
    guessed = None
    for a in anchors:
        window = jornada_window(fixtures, competition, a["jornada"])
        if window and window[0] <= today <= window[1]:
            guessed = a["jornada"]
            break
    if guessed is None:
        future = next((a for a in anchors if a["date"] >= today), None)
        guessed = (future or anchors[-1])["jornada"]

    if competition == "LaLiga":
        rounds = [a["jornada"] for a in anchors]
        try:
            idx = rounds.index(int(guessed))
        except ValueError:
            idx = -1
        # Si la jornada anterior todavía ocupa el día de hoy según LALIGA oficial,
        # se mantiene. Esto evita saltar de J5 a J6 antes del último partido del lunes.
        if idx > 0:
            previous = rounds[idx - 1]
            prev_window = get_laliga_official_round_window(previous)
            if prev_window and prev_window[0] <= today <= prev_window[1]:
                return previous
        own_window = get_laliga_official_round_window(int(guessed))
        if own_window and own_window[0] <= today <= own_window[1]:
            return int(guessed)

    return int(guessed)


def build_jornada_payload(fixtures: list[dict], competition: str, today: date) -> dict | None:
    jornada = choose_jornada_candidate(fixtures, competition, today)
    if jornada is None:
        return None
    anchors = jornada_anchors(fixtures, competition)
    rounds = [a["jornada"] for a in anchors]

    # Si la jornada anterior todavía no ha terminado, se mantiene aunque la
    # siguiente tenga un partido adelantado ya disputado.
    try:
        idx = rounds.index(int(jornada))
    except ValueError:
        idx = -1
    if idx > 0:
        previous = rounds[idx - 1]
        prev_payload = build_specific_jornada_payload(fixtures, competition, previous, today)
        if prev_payload and prev_payload.get("phase") != "complete":
            return prev_payload

    payload = build_specific_jornada_payload(fixtures, competition, jornada, today)
    if not payload:
        return None
    if payload.get("phase") == "complete":
        next_round = next((r for r in rounds if r > int(jornada)), None)
        if next_round is not None:
            next_payload = build_specific_jornada_payload(fixtures, competition, next_round, today)
            if next_payload:
                return next_payload
    return payload


def refresh_jornadas(data: dict) -> int:
    fixtures = data.get("fixtures") or []
    today = datetime.now(TZ).date()
    successes = 0
    jornadas = data.setdefault("jornadas", {})
    jornadas_next = data.setdefault("jornadasNext", {})
    for competition in ("LaLiga", "Champions"):
        try:
            payload = build_jornada_payload(fixtures, competition, today)
            if payload and payload.get("matches"):
                jornadas[competition] = payload
                successes += 1
                log(f"Jornada {competition}: J{payload['jornada']} · {len(payload['matches'])} partidos · {payload['phase']}")

                rounds = [a["jornada"] for a in jornada_anchors(fixtures, competition)]
                next_round = next((r for r in rounds if r > int(payload["jornada"])), None)
                if next_round is not None:
                    nxt = build_specific_jornada_payload(fixtures, competition, next_round, today)
                    if nxt and nxt.get("matches"):
                        jornadas_next[competition] = nxt
        except Exception as exc:
            log(f"AVISO jornada {competition}: {exc}")
    return successes


def get_laliga_range_schedule(start_day: date, end_day: date) -> list[dict]:
    """Secondary schedule source from the LaLiga scoreboard over a date range.

    This catches newly confirmed dates/times that a team schedule endpoint may expose late.
    Only Real Madrid events are returned.
    """
    start_s = start_day.strftime("%Y%m%d")
    end_s = end_day.strftime("%Y%m%d")
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates={start_s}-{end_s}&limit=200"
    payload = fetch_json(url)
    out = []
    for evt in payload.get("events") or []:
        item = generic_event(evt, "LaLiga")
        if item:
            rm = madrid_event(item)
            if rm:
                out.append(rm)
    return out


def fixture_match_index(fixtures: list[dict], event: dict) -> int | None:
    candidates = [i for i, fx in enumerate(fixtures)
                  if fx.get("competition") == event.get("competition") and same_team(fx.get("opponent", ""), event.get("opponent", ""))]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    try:
        event_date = datetime.fromisoformat(event["date"]).date()
    except Exception:
        return candidates[0]
    return min(candidates, key=lambda i: abs((datetime.fromisoformat(fixtures[i]["date"]).date() - event_date).days))


def merge_schedule(fixtures: list[dict], events: list[dict]) -> None:
    for event in events:
        idx = fixture_match_index(fixtures, event)
        if idx is None:
            if event.get("competition") == "Champions":
                new_fx = deepcopy(event)
                new_fx["jornada"] = None
                new_fx["tv"] = []
                fixtures.append(new_fx)
            continue
        fx = fixtures[idx]
        for key in ("date", "displayDate", "venue"):
            if event.get(key) is not None:
                fx[key] = event[key]
        if valid_time(event.get("time")):
            fx["time"] = valid_time(event.get("time"))
        elif event.get("time") is not None:
            fx["time"] = None

        old_status, old_score = fx.get("status"), fx.get("score")
        new_status, new_score = event.get("status"), event.get("score")
        if old_status == "finished" and old_score:
            fx.pop("liveLabel", None)
        elif new_status == "finished" and new_score:
            fx["status"], fx["score"] = "finished", new_score
            fx.pop("liveLabel", None)
        elif new_status == "live":
            fx["status"] = "live"
            if new_score is not None:
                fx["score"] = new_score
            fx["liveLabel"] = event.get("liveLabel") or "En juego"
        elif old_status != "live":
            fx["status"] = "scheduled"
            if not fx.get("score"):
                fx["score"] = None
            fx.pop("liveLabel", None)


def merge_laliga_official(fixtures: list[dict], events: list[dict]) -> None:
    for event in events:
        idx = fixture_match_index(fixtures, event)
        if idx is None:
            continue
        fx = fixtures[idx]
        # LALIGA is authoritative for LaLiga calendar/TV. A confirmed date/time
        # must replace the original weekend placeholder.
        for key in ("date", "displayDate", "venue"):
            if event.get(key) is not None:
                fx[key] = event[key]
        # La web oficial manda también cuando todavía NO hay hora: si muestra
        # --:--, eliminamos cualquier hora provisional de una fuente secundaria.
        fx["time"] = valid_time(event.get("time"))
        fx["_officialTimeSeen"] = True
        fx["_officialTimeSource"] = event.get("officialSource") or "LALIGA"
        if event.get("tv"):
            fx["tv"] = event["tv"]



def enforce_official_future_laliga_times(fixtures: list[dict], official_sources_ok: bool) -> None:
    """No publica horas futuras de LaLiga que no estén confirmadas oficialmente.

    ESPN se mantiene para resultados/directo, pero no decide por sí solo una hora
    futura. Si al menos una fuente oficial respondió correctamente y un partido
    futuro no pudo verificarse en ninguna de ellas, se muestra "Por confirmar".
    """
    today = datetime.now(TZ).date()
    for fx in fixtures:
        if fx.get("competition") != "LaLiga" or fx.get("status") == "finished":
            fx.pop("_officialTimeSeen", None)
            fx.pop("_officialTimeSource", None)
            continue
        try:
            day = date.fromisoformat(fx.get("date", ""))
        except Exception:
            fx.pop("_officialTimeSeen", None)
            fx.pop("_officialTimeSource", None)
            continue
        if day < today:
            fx.pop("_officialTimeSeen", None)
            fx.pop("_officialTimeSource", None)
            continue
        seen = bool(fx.pop("_officialTimeSeen", False))
        fx.pop("_officialTimeSource", None)
        if official_sources_ok and not seen:
            fx["time"] = None


def apply_baseline_results(fixtures: list[dict]) -> None:
    for known in BASELINE_RESULTS:
        for fx in fixtures:
            if fx.get("competition") == known["competition"] and fx.get("date") == known["date"] and same_team(fx.get("opponent", ""), known["opponent"]):
                fx.update(status="finished", score=known["score"], venue=known["venue"])
                fx.pop("liveLabel", None)
                break


def stat_map(entry: dict) -> dict:
    return {s.get("name"): s.get("value") for s in (entry.get("stats") or []) if s.get("name")}


def stat(stats: dict, *names: str, default=0):
    for name in names:
        if stats.get(name) is not None:
            return stats[name]
    return default


def intish(value, default=0) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


def standings_entries(payload: dict) -> list[dict]:
    collected = []
    for group in payload.get("children") or []:
        for entry in (group.get("standings") or {}).get("entries") or []:
            collected.append(entry)
    if not collected:
        collected.extend((payload.get("standings") or {}).get("entries") or [])
    return collected


def parse_standings(payload: dict) -> list[dict]:
    rows, seen = [], set()
    for entry in standings_entries(payload):
        team = entry.get("team") or {}
        name = team.get("displayName") or team.get("name")
        if not name or name in seen:
            continue
        seen.add(name)
        s = stat_map(entry)
        rows.append({
            "pos": intish(stat(s,"rank","position",default=len(rows)+1)), "team": name,
            "pts": intish(stat(s,"points",default=0)), "pj": intish(stat(s,"gamesPlayed",default=0)),
            "g": intish(stat(s,"wins",default=0)), "e": intish(stat(s,"ties","draws",default=0)),
            "p": intish(stat(s,"losses",default=0)), "gf": intish(stat(s,"pointsFor","goalsFor",default=0)),
            "gc": intish(stat(s,"pointsAgainst","goalsAgainst",default=0)),
            "dg": intish(stat(s,"pointDifferential","goalDifference",default=0)),
        })
    rows.sort(key=lambda x: x["pos"])
    return rows


def find_row(rows: list[dict], team_name: str) -> dict | None:
    return next((r for r in rows if same_team(r.get("team", ""), team_name)), None)


def apply_match_to_row(row: dict, gf: int, gc: int, *, live: bool, label: str, score: str) -> None:
    row["pj"] += 1
    row["gf"] += gf
    row["gc"] += gc
    row["dg"] = row["gf"] - row["gc"]
    if gf > gc:
        row["g"] += 1; row["pts"] += 3
    elif gf == gc:
        row["e"] += 1; row["pts"] += 1
    else:
        row["p"] += 1
    row["provisional"] = True
    row["live"] = live
    row["liveLabel"] = label
    row["liveScore"] = score


def mark_provisional_row(row: dict, *, live: bool, label: str, score: str) -> None:
    row["provisional"] = True
    row["live"] = live
    row["liveLabel"] = label
    row["liveScore"] = score


def provisional_standings(
    official: list[dict],
    previous_official: list[dict],
    events: list[dict],
    source_includes_live: bool = False,
) -> tuple[list[dict], list[dict], bool]:
    """Añade partidos en directo (o recién acabados aún no reflejados oficialmente).

    También detecta si la fuente de clasificación ya está incorporando el partido
    en directo para evitar sumar dos veces PJ/puntos.
    """
    rows = deepcopy(official)
    base_pos = {normalize_name(r["team"]): r["pos"] for r in official}
    adjustments = []
    detected_source_live = source_includes_live

    for ev in events:
        if ev.get("status") not in {"live", "finished"}:
            continue
        if ev.get("homeScore") is None or ev.get("awayScore") is None:
            continue

        home = find_row(rows, ev["home"]); away = find_row(rows, ev["away"])
        if not home or not away:
            continue
        prev_home = find_row(previous_official, ev["home"]) if previous_official else None
        prev_away = find_row(previous_official, ev["away"]) if previous_official else None
        live = ev["status"] == "live"
        label = ev.get("liveLabel") or ("En juego" if live else "Pendiente de oficializar")

        home_reflected = bool(prev_home and home["pj"] > prev_home["pj"])
        away_reflected = bool(prev_away and away["pj"] > prev_away["pj"])

        # Si durante un partido en directo la tabla oficial incrementó PJ para
        # ambos equipos, recordamos que esa fuente ya está calculando el vivo.
        if live and home_reflected and away_reflected:
            detected_source_live = True

        if live and detected_source_live:
            mark_provisional_row(home, live=True, label=label, score=ev["score"])
            mark_provisional_row(away, live=True, label=label, score=ev["score"])
            adjustments.append(ev)
            continue

        # Resultado final ya incorporado por la clasificación oficial: no hay
        # nada provisional que añadir.
        if not live and home_reflected and away_reflected:
            continue

        if not home_reflected:
            apply_match_to_row(home, ev["homeScore"], ev["awayScore"], live=live, label=label, score=ev["score"])
        else:
            mark_provisional_row(home, live=live, label=label, score=ev["score"])
        if not away_reflected:
            apply_match_to_row(away, ev["awayScore"], ev["homeScore"], live=live, label=label, score=ev["score"])
        else:
            mark_provisional_row(away, live=live, label=label, score=ev["score"])
        adjustments.append(ev)

    rows.sort(key=lambda r: (-r["pts"], -r["dg"], -r["gf"], base_pos.get(normalize_name(r["team"]), 999)))
    for pos, row in enumerate(rows, 1):
        row["pos"] = pos
    return rows, adjustments, detected_source_live

def build_monitor_windows(scoreboards: dict[tuple[str,str], list[dict]]) -> list[dict]:
    windows = []
    for (competition, day_text), events in scoreboards.items():
        for ev in events:
            try:
                kickoff = datetime.fromisoformat(ev["kickoff"])
            except Exception:
                continue
            start = kickoff - timedelta(minutes=15)
            # 3h30 cubre prórroga/penaltis y retrasos sin dejar activo todo el día.
            end = kickoff + timedelta(minutes=210)
            windows.append({
                "competition": competition, "date": day_text, "eventId": ev.get("eventId"),
                "start": start.isoformat(timespec="minutes"), "end": end.isoformat(timespec="minutes"),
            })
    return windows


def active_monitor_dates(data: dict, now: datetime) -> set[tuple[str, date]]:
    active = set()
    for w in data.get("monitorWindows") or []:
        try:
            start = datetime.fromisoformat(w["start"]); end = datetime.fromisoformat(w["end"])
            if start.tzinfo is None: start = start.replace(tzinfo=TZ)
            if end.tzinfo is None: end = end.replace(tzinfo=TZ)
            if start <= now <= end:
                active.add((w["competition"], date.fromisoformat(w["date"])))
        except Exception:
            continue
    return active



def sanitize_stale_fixture_states(fixtures: list[dict]) -> None:
    """Evita que un partido antiguo quede eternamente marcado como 'live'."""
    now = datetime.now(TZ)
    for fx in fixtures:
        status = fx.get("status")
        if status == "finished":
            fx.pop("liveLabel", None)
            continue
        if status != "live" or not fx.get("date"):
            continue
        try:
            kickoff = datetime.fromisoformat(
                f"{fx['date']}T{fx.get('time') or '00:00'}:00"
            ).replace(tzinfo=TZ)
        except Exception:
            continue
        # Margen amplio para prórroga, penaltis, retrasos o incidencias.
        if now - kickoff > timedelta(hours=4):
            fx["status"] = "finished" if fx.get("score") else "scheduled"
            fx.pop("liveLabel", None)

def choose_next_match(fixtures: list[dict]) -> dict | None:
    live = next((deepcopy(fx) for fx in fixtures if fx.get("status") == "live"), None)
    if live:
        return live
    now = datetime.now(TZ)
    candidates = []
    for fx in fixtures:
        if fx.get("status") == "finished" or not fx.get("date"):
            continue
        try:
            t = fx.get("time") or "23:59"
            dt = datetime.fromisoformat(f"{fx['date']}T{t}:00").replace(tzinfo=TZ)
        except Exception:
            continue
        if dt >= now:
            candidates.append((dt, fx))
    if not candidates:
        return None
    return deepcopy(min(candidates, key=lambda x: x[0])[1])


def meaningful_snapshot(data: dict) -> dict:
    copy = deepcopy(data)
    if isinstance(copy.get("app"), dict):
        copy["app"].pop("lastUpdated", None)
        copy["app"].pop("lastChecked", None)
    if isinstance(copy.get("live"), dict):
        copy["live"].pop("updatedAt", None)
    for meta in (copy.get("standingsMeta") or {}).values():
        if isinstance(meta, dict):
            meta.pop("updatedAt", None)
    return copy


def update_live_payload(data: dict, scoreboards: dict[tuple[str,str], list[dict]], previous: dict) -> int:
    fixtures = data.setdefault("fixtures", [])
    all_by_comp = {"LaLiga": [], "Champions": []}
    for (competition, _day), events in scoreboards.items():
        all_by_comp[competition].extend(events)
        # Actualizar el partido del Madrid si está en ese marcador.
        merge_schedule(fixtures, [rm for ev in events if (rm := madrid_event(ev))])

    live_matches = [ev for events in all_by_comp.values() for ev in events if ev.get("status") == "live"]
    data["live"] = {
        "hasLiveMatches": bool(live_matches),
        "updatedAt": datetime.now(TZ).isoformat(timespec="minutes"),
        "matches": live_matches,
    }

    changed_standings = 0
    for competition, official_key, active_key, url_key in (
        ("LaLiga", "laligaOfficialStandings", "laligaStandings", "laliga_standings"),
        ("Champions", "championsOfficialStandings", "championsStandings", "champions_standings"),
    ):
        try:
            official = parse_standings(fetch_json(URLS[url_key]))
        except Exception as exc:
            log(f"AVISO clasificación {competition}: {exc}")
            official = deepcopy(data.get(official_key) or data.get(active_key) or [])
        min_rows = 18 if competition == "LaLiga" else 24
        if len(official) < min_rows:
            if competition == "Champions":
                data["championsStandingsStatus"] = "not_started"
            continue

        prev_official = deepcopy(previous.get(official_key) or previous.get(active_key) or official)
        data[official_key] = deepcopy(official)

        # Mientras el partido está en juego calculamos provisionalmente. Si acaba
        # y la tabla oficial aún no ha absorbido el resultado, mantenemos también
        # ese resultado final para evitar que la clasificación salte hacia atrás.
        relevant = [ev for ev in all_by_comp[competition] if ev.get("status") in {"live", "finished"} and ev.get("score")]
        previous_meta = (previous.get("standingsMeta") or {}).get(competition) or {}
        prior_source_live = bool(previous_meta.get("sourceIncludesLive")) if relevant else False
        active_rows, adjustments, source_live = provisional_standings(
            official, prev_official, relevant, prior_source_live
        )
        mode = "provisional" if adjustments else "official"
        data[active_key] = active_rows if adjustments else deepcopy(official)
        data.setdefault("standingsMeta", {})[competition] = {
            "mode": mode,
            "liveGames": sum(1 for ev in adjustments if ev.get("status") == "live"),
            "pendingOfficialGames": sum(1 for ev in adjustments if ev.get("status") == "finished"),
            "sourceIncludesLive": source_live,
            "updatedAt": datetime.now(TZ).isoformat(timespec="minutes"),
        }
        if competition == "Champions":
            data["championsStandingsStatus"] = "active"
        changed_standings += 1
    return changed_standings


def full_refresh(data: dict, original: dict) -> int:
    successes = 0
    fixtures = data.setdefault("fixtures", [])
    apply_baseline_results(fixtures)

    for key, competition in (("laliga_schedule","LaLiga"),("champions_schedule","Champions")):
        try:
            events = get_team_schedule(URLS[key], competition)
            if events:
                merge_schedule(fixtures, events); successes += 1
                log(f"{competition}: {len(events)} partidos del Madrid recibidos")
        except Exception as exc:
            log(f"AVISO calendario {competition}: {exc}")

    # Segunda fuente para LaLiga: calendario oficial, horarios y TV en España.
    # Fuente secundaria de calendario: rango amplio de LaLiga para captar horarios
    # recién confirmados aunque el endpoint de equipo o la web oficial se retrasen.
    try:
        today_for_schedule = datetime.now(TZ).date()
        range_events = get_laliga_range_schedule(today_for_schedule - timedelta(days=2), today_for_schedule + timedelta(days=120))
        if range_events:
            merge_schedule(fixtures, range_events)
            successes += 1
            log(f"LaLiga rango: {len(range_events)} partidos del Madrid recibidos")
    except Exception as exc:
        log(f"AVISO calendario LaLiga por rango: {exc}")

    official_source_ok = False
    try:
        official_laliga = get_laliga_official_schedule()
        if official_laliga:
            merge_laliga_official(fixtures, official_laliga)
            successes += 1
            official_source_ok = True
            log(f"LALIGA oficial: {len(official_laliga)} partidos/horarios recibidos")
        else:
            log("AVISO LALIGA oficial: no se pudieron extraer partidos")
    except Exception as exc:
        log(f"AVISO LALIGA oficial: {exc}")

    # Segunda fuente oficial para los partidos del Madrid: realmadrid.com.
    # Sirve también para anular horas provisionales cuando el club publica
    # expresamente "fecha y hora por confirmar".
    try:
        official_rm = get_real_madrid_official_laliga_schedule(fixtures)
        if official_rm:
            merge_laliga_official(fixtures, official_rm)
            successes += 1
            official_source_ok = True
            log(f"Real Madrid oficial: {len(official_rm)} partidos/horarios de LaLiga recibidos")
        else:
            log("AVISO Real Madrid oficial: no se pudieron extraer partidos de LaLiga")
    except Exception as exc:
        log(f"AVISO Real Madrid oficial: {exc}")

    enforce_official_future_laliga_times(fixtures, official_source_ok)

    # Jornada completa de Liga y Champions. Se conserva la jornada hasta que
    # finaliza el último partido no aplazado; después pasa a la siguiente.
    successes += refresh_jornadas(data)

    # Scoreboards de hoy: sirven para detectar todas las ventanas de Liga/Champions.
    today = datetime.now(TZ).date()
    scoreboards = {}
    for competition in ("LaLiga", "Champions"):
        try:
            scoreboards[(competition, today.isoformat())] = get_scoreboard(competition, today)
            successes += 1
        except Exception as exc:
            log(f"AVISO marcador diario {competition}: {exc}")
            scoreboards[(competition, today.isoformat())] = []
    data["monitorWindows"] = build_monitor_windows(scoreboards)

    # Aprovechamos la misma lectura para directo/provisional y tablas oficiales.
    successes += update_live_payload(data, scoreboards, original)
    sanitize_stale_fixture_states(fixtures)
    fixtures.sort(key=lambda x: (x.get("date") or "9999-99-99", x.get("time") or "99:99"))
    return successes


def live_refresh(data: dict, original: dict) -> int:
    now = datetime.now(TZ)
    active = active_monitor_dates(data, now)
    if not active:
        log("Fuera de una ventana de partido: no se consulta ninguna API en el ciclo de 5 minutos.")
        return -1

    scoreboards = {}
    successes = 0
    for competition, day in sorted(active, key=lambda x: (x[1], x[0])):
        try:
            scoreboards[(competition, day.isoformat())] = get_scoreboard(competition, day)
            successes += 1
        except Exception as exc:
            log(f"AVISO directo {competition} {day}: {exc}")
            scoreboards[(competition, day.isoformat())] = []

    successes += update_live_payload(data, scoreboards, original)
    sanitize_stale_fixture_states(data.setdefault("fixtures", []))
    data.setdefault("fixtures", []).sort(key=lambda x: (x.get("date") or "9999-99-99", x.get("time") or "99:99"))
    return successes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-only", action="store_true", help="Ciclo de 5 minutos; solo actúa en ventanas de partido")
    args = parser.parse_args()

    if not JSON_PATH.exists():
        log("ERROR: no existe real_madrid.json")
        return 2

    original = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    data = deepcopy(original)

    if args.live_only:
        successes = live_refresh(data, original)
        if successes == -1:
            return 0
    else:
        successes = full_refresh(data, original)

    sanitize_stale_fixture_states(data.get("fixtures") or [])
    nxt = choose_next_match(data.get("fixtures") or [])
    if nxt:
        data["nextMatch"] = nxt

    if successes <= 0:
        log("No hubo datos válidos para actualizar.")
        return 0

    # Saneamiento final: nunca publicar horas mal formadas ni metadatos de directo
    # en partidos que ya están finalizados.
    for fx in data.get("fixtures", []):
        fx["time"] = valid_time(fx.get("time"))
        if fx.get("status") == "finished":
            for key in ("liveLabel", "liveScore", "livePoints", "liveOutcome"):
                fx.pop(key, None)
    if isinstance(data.get("nextMatch"), dict):
        data["nextMatch"]["time"] = valid_time(data["nextMatch"].get("time"))
        if data["nextMatch"].get("status") == "finished":
            for key in ("liveLabel", "liveScore", "livePoints", "liveOutcome"):
                data["nextMatch"].pop(key, None)

    now_text = datetime.now(TZ).isoformat(timespec="minutes")
    substantive_changed = meaningful_snapshot(data) != meaningful_snapshot(original)
    app = data.setdefault("app", {})
    app["lastChecked"] = now_text
    if substantive_changed:
        app["lastUpdated"] = now_text
        log("Hay cambios reales en los datos.")
    else:
        # Conservamos la hora de la última modificación real, pero registramos
        # que la rutina sí ha comprobado las fuentes.
        app["lastUpdated"] = (original.get("app") or {}).get("lastUpdated", app.get("lastUpdated", now_text))
        log("Sin cambios reales; se actualiza solo 'lastChecked'.")

    JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log("real_madrid.json guardado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
