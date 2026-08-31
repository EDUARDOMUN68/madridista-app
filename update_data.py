#!/usr/bin/env python3
"""
Actualizador automático de Madridista.

Fuentes principales:
- ESPN public site API: calendario/resultados de Real Madrid y clasificaciones.
- Conserva los datos anteriores si una fuente falla.
- NO necesita API key ni secretos.

Actualiza:
- Fechas y horas de LaLiga / Champions cuando la fuente las publique.
- Resultados del Real Madrid.
- Clasificación de LaLiga.
- Clasificación de Champions cuando exista.
- Próximo partido.
- Añade nuevos cruces de Champions cuando aparezcan en el calendario.

La TV española se conserva desde el JSON existente; no se sustituye con
emisiones de ESPN porque no son necesariamente las de España.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT / "real_madrid.json"

TEAM_ID = "86"  # Real Madrid en ESPN
TZ = ZoneInfo("Europe/Madrid")

URLS = {
    "laliga_schedule": (
        "https://site.api.espn.com/apis/site/v2/sports/soccer/"
        "esp.1/teams/86/schedule?season=2026"
    ),
    "champions_schedule": (
        "https://site.api.espn.com/apis/site/v2/sports/soccer/"
        "uefa.champions/teams/86/schedule?season=2026"
    ),
    "laliga_standings": (
        "https://site.api.espn.com/apis/v2/sports/soccer/"
        "esp.1/standings?season=2026"
    ),
    "champions_standings": (
        "https://site.api.espn.com/apis/v2/sports/soccer/"
        "uefa.champions/standings?season=2026"
    ),
}

LEAGUE_SLUGS = {
    "LaLiga": "esp.1",
    "Champions": "uefa.champions",
}

# Resultados ya confirmados cuando se puso en marcha la app.
# Sirven como red de seguridad para que una fuente externa nunca pueda
# convertir accidentalmente estos partidos ya jugados en "pendientes".
BASELINE_RESULTS = [
    {"competition": "LaLiga", "date": "2026-08-22", "opponent": "RCD Espanyol", "venue": "away", "score": "1–2"},
    {"competition": "LaLiga", "date": "2026-08-26", "opponent": "Real Sociedad", "venue": "home", "score": "4–1"},
    {"competition": "LaLiga", "date": "2026-08-30", "opponent": "Málaga CF", "venue": "home", "score": "4–0"},
]

MONTHS_ES = {
    1: "enero", 2: "febrero", 3: "marzo", 4: "abril",
    5: "mayo", 6: "junio", 7: "julio", 8: "agosto",
    9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre",
}
WEEKDAYS_ES = {
    0: "Lun.", 1: "Mar.", 2: "Mié.", 3: "Jue.",
    4: "Vie.", 5: "Sáb.", 6: "Dom.",
}

NAME_ALIASES = {
    "inter milan": "inter de milan",
    "internazionale": "inter de milan",
    "internazionale milano": "inter de milan",
    "as roma": "roma",
    "roma": "roma",
    "aek athens": "aek atenas",
    "aek athens fc": "aek atenas",
    "psv eindhoven": "psv",
    "lask linz": "lask",
    "rb leipzig": "rb leipzig",
    "racing santander": "racing de santander",
    "racing de santander": "racing de santander",
    "deportivo la coruna": "rc deportivo",
    "deportivo de la coruna": "rc deportivo",
    "deportivo": "rc deportivo",
    "espanyol": "rcd espanyol",
    "real betis": "real betis",
    "malaga": "malaga cf",
    "athletic bilbao": "athletic club",
    "alaves": "deportivo alaves",
    "celta vigo": "celta",
}


def log(msg: str) -> None:
    print(f"[Madridista] {msg}")


def fetch_json(url: str) -> dict:
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; MadridistaUpdater/1.0; "
                "+https://github.com/)"
            ),
            "Accept": "application/json,text/plain,*/*",
        },
    )
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_name(value: str | None) -> str:
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.lower()
    value = value.replace("&", " y ")
    value = re.sub(r"\b(fc|cf|club de futbol|football club)\b", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return NAME_ALIASES.get(value, value)


def same_team(a: str, b: str) -> bool:
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if na in nb or nb in na:
        return True
    return SequenceMatcher(None, na, nb).ratio() >= 0.72


def parse_iso(dt_text: str) -> datetime:
    return datetime.fromisoformat(dt_text.replace("Z", "+00:00")).astimezone(TZ)


def display_date(dt: datetime) -> str:
    return f"{WEEKDAYS_ES[dt.weekday()]} {dt.day} {MONTHS_ES[dt.month]}"


def score_value(comp: dict) -> str | None:
    score = comp.get("score")
    if isinstance(score, dict):
        for key in ("displayValue", "value"):
            if score.get(key) is not None:
                return str(score[key])
    if score is not None and not isinstance(score, dict):
        return str(score)
    return None


def extract_event(evt: dict, competition_name: str) -> dict | None:
    comps = evt.get("competitions") or []
    if not comps:
        return None
    comp = comps[0]
    competitors = comp.get("competitors") or []
    if len(competitors) < 2:
        return None

    madrid = None
    rival = None
    for c in competitors:
        team = c.get("team") or {}
        team_id = str(team.get("id", ""))
        name = team.get("displayName") or team.get("name") or ""
        if team_id == TEAM_ID or same_team(name, "Real Madrid"):
            madrid = c
        else:
            rival = c

    if not madrid or not rival:
        return None

    dt = parse_iso(evt["date"])
    venue = "home" if madrid.get("homeAway") == "home" else "away"

    status_type = ((evt.get("status") or {}).get("type") or {})
    completed = bool(status_type.get("completed"))
    state = status_type.get("state")

    score = None
    if completed or state == "in":
        rm_score = score_value(madrid)
        rv_score = score_value(rival)
        if rm_score is not None and rv_score is not None:
            # Guardamos siempre marcador local–visitante, como hace la app.
            if venue == "home":
                score = f"{rm_score}–{rv_score}"
            else:
                score = f"{rv_score}–{rm_score}"

    rival_team = rival.get("team") or {}
    rival_name = rival_team.get("displayName") or rival_team.get("name") or "Rival"

    return {
        "competition": competition_name,
        "date": dt.date().isoformat(),
        "displayDate": display_date(dt),
        "time": dt.strftime("%H:%M"),
        "venue": venue,
        "opponent": rival_name,
        "status": "finished" if completed else ("live" if state == "in" else "scheduled"),
        "score": score,
    }


def get_events(url: str, competition_name: str) -> list[dict]:
    payload = fetch_json(url)
    result = []
    for evt in payload.get("events") or []:
        item = extract_event(evt, competition_name)
        if item:
            result.append(item)
    return result


def fixture_match_index(fixtures: list[dict], event: dict) -> int | None:
    candidates = []
    for i, fx in enumerate(fixtures):
        if fx.get("competition") != event["competition"]:
            continue
        if same_team(fx.get("opponent", ""), event["opponent"]):
            candidates.append(i)

    if not candidates:
        return None

    if len(candidates) == 1:
        return candidates[0]

    # Si hay ida/vuelta contra el mismo rival, escoger la fecha más cercana.
    event_date = datetime.fromisoformat(event["date"]).date()
    best = None
    best_delta = 10**9
    for i in candidates:
        try:
            d = datetime.fromisoformat(fixtures[i]["date"]).date()
            delta = abs((d - event_date).days)
        except Exception:
            delta = 10**8
        if delta < best_delta:
            best, best_delta = i, delta
    return best


def merge_schedule(fixtures: list[dict], events: list[dict]) -> None:
    """Mezcla datos sin degradar nunca un resultado ya confirmado."""
    for event in events:
        idx = fixture_match_index(fixtures, event)
        if idx is None:
            # Muy útil para futuras eliminatorias de Champions:
            # si el cruce aparece en ESPN y no estaba en nuestro JSON, se añade.
            if event["competition"] == "Champions":
                new_fx = deepcopy(event)
                new_fx["jornada"] = None
                new_fx["tv"] = []
                fixtures.append(new_fx)
            continue

        fx = fixtures[idx]

        # Fecha/hora/campo sí pueden actualizarse cuando la fuente publica
        # información más precisa.
        for key in ("date", "displayDate", "time", "venue"):
            if event.get(key) is not None:
                fx[key] = event[key]

        old_status = fx.get("status")
        old_score = fx.get("score")
        new_status = event.get("status")
        new_score = event.get("score")

        # Regla crítica: un partido ya finalizado con marcador NUNCA vuelve
        # a scheduled/pending aunque una API devuelva un estado incompleto.
        if old_status == "finished" and old_score:
            pass
        elif new_status == "finished" and new_score:
            fx["status"] = "finished"
            fx["score"] = new_score
        elif new_status == "live":
            fx["status"] = "live"
            if new_score:
                fx["score"] = new_score
        elif old_status != "live":
            fx["status"] = "scheduled"
            # Nunca borrar un marcador ya almacenado por recibir None.
            if not fx.get("score"):
                fx["score"] = None

        # Nombre del rival: conservar el nombre que ya usamos si existe.
        if not fx.get("opponent"):
            fx["opponent"] = event["opponent"]


def apply_baseline_results(fixtures: list[dict]) -> int:
    """Restaura el histórico inicial confirmado de la app."""
    repaired = 0
    for known in BASELINE_RESULTS:
        for fx in fixtures:
            if fx.get("competition") != known["competition"]:
                continue
            if fx.get("date") != known["date"]:
                continue
            if not same_team(fx.get("opponent", ""), known["opponent"]):
                continue
            if fx.get("status") != "finished" or fx.get("score") != known["score"]:
                fx["status"] = "finished"
                fx["score"] = known["score"]
                fx["venue"] = known["venue"]
                repaired += 1
            break
    if repaired:
        log(f"Histórico base: {repaired} resultado(s) restaurado(s)")
    return repaired


def scoreboard_url(competition: str, day) -> str:
    slug = LEAGUE_SLUGS[competition]
    return (
        "https://site.api.espn.com/apis/site/v2/sports/soccer/"
        f"{slug}/scoreboard?dates={day.strftime('%Y%m%d')}"
    )


def scoreboard_events_for_date(competition: str, day) -> list[dict]:
    payload = fetch_json(scoreboard_url(competition, day))
    items = []
    for evt in payload.get("events") or []:
        item = extract_event(evt, competition)
        if item:
            items.append(item)
    return items


def repair_past_results(fixtures: list[dict]) -> int:
    """
    Busca de forma específica el marcador de partidos cuya fecha ya pasó
    pero que siguen sin figurar como finalizados. Consulta el marcador del
    día (y un día alrededor por posibles diferencias horarias).
    """
    today = datetime.now(TZ).date()
    cache: dict[tuple[str, str], list[dict]] = {}
    repaired = 0

    for fx in fixtures:
        if fx.get("competition") not in LEAGUE_SLUGS:
            continue
        if fx.get("status") == "finished" and fx.get("score"):
            continue
        try:
            match_day = datetime.fromisoformat(fx["date"]).date()
        except Exception:
            continue
        if match_day >= today:
            continue

        found = None
        for offset in (0, -1, 1):
            day = match_day + timedelta(days=offset)
            key = (fx["competition"], day.isoformat())
            if key not in cache:
                try:
                    cache[key] = scoreboard_events_for_date(fx["competition"], day)
                except Exception as exc:
                    log(f"AVISO marcador {fx['competition']} {day}: {exc}")
                    cache[key] = []

            for event in cache[key]:
                if not same_team(event.get("opponent", ""), fx.get("opponent", "")):
                    continue
                if event.get("status") == "finished" and event.get("score"):
                    found = event
                    break
            if found:
                break

        if found:
            for key in ("date", "displayDate", "time", "venue"):
                if found.get(key) is not None:
                    fx[key] = found[key]
            fx["status"] = "finished"
            fx["score"] = found["score"]
            repaired += 1
            log(f"Resultado reparado: {fx.get('opponent')} {fx['score']}")

    return repaired


def stat_map(entry: dict) -> dict[str, float]:
    result = {}
    for s in entry.get("stats") or []:
        name = s.get("name")
        if name:
            result[name] = s.get("value")
    return result


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
    # ESPN puede devolver grupos dentro de children.
    groups = payload.get("children") or []
    collected = []
    for group in groups:
        standings = group.get("standings") or {}
        for entry in standings.get("entries") or []:
            collected.append(entry)

    # Algunos endpoints usan standings directamente.
    if not collected:
        for entry in (payload.get("standings") or {}).get("entries") or []:
            collected.append(entry)
    return collected


def parse_standings(payload: dict) -> list[dict]:
    rows = []
    seen = set()

    for entry in standings_entries(payload):
        team = entry.get("team") or {}
        name = team.get("displayName") or team.get("name")
        if not name or name in seen:
            continue
        seen.add(name)

        s = stat_map(entry)
        row = {
            "pos": intish(stat(s, "rank", "position", default=len(rows) + 1)),
            "team": name,
            "pts": intish(stat(s, "points", default=0)),
            "pj": intish(stat(s, "gamesPlayed", default=0)),
            "g": intish(stat(s, "wins", default=0)),
            "e": intish(stat(s, "ties", "draws", default=0)),
            "p": intish(stat(s, "losses", default=0)),
            "gf": intish(stat(s, "pointsFor", "goalsFor", default=0)),
            "gc": intish(stat(s, "pointsAgainst", "goalsAgainst", default=0)),
            "dg": intish(stat(s, "pointDifferential", "goalDifference", default=0)),
        }
        rows.append(row)

    rows.sort(key=lambda x: x["pos"])
    return rows


def choose_next_match(fixtures: list[dict]) -> dict | None:
    now = datetime.now(TZ)
    candidates = []

    for fx in fixtures:
        if fx.get("status") == "finished":
            continue
        date_text = fx.get("date")
        if not date_text:
            continue
        try:
            if fx.get("time"):
                dt = datetime.fromisoformat(
                    f"{date_text}T{fx['time']}:00"
                ).replace(tzinfo=TZ)
            else:
                dt = datetime.fromisoformat(
                    f"{date_text}T23:59:59"
                ).replace(tzinfo=TZ)
        except Exception:
            continue
        if dt >= now:
            candidates.append((dt, fx))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0])
    return deepcopy(candidates[0][1])


def meaningful_snapshot(data: dict) -> dict:
    copy = deepcopy(data)
    if isinstance(copy.get("app"), dict):
        copy["app"].pop("lastUpdated", None)
    return copy


def main() -> int:
    if not JSON_PATH.exists():
        log("ERROR: no existe real_madrid.json")
        return 2

    original = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    data = deepcopy(original)
    fixtures = data.setdefault("fixtures", [])

    # Antes de consultar ninguna API, blindamos los resultados que ya estaban
    # confirmados al crear la app. Esto repara también el problema de la v1.
    apply_baseline_results(fixtures)

    successes = 0

    # Calendarios/resultados
    for key, competition in (
        ("laliga_schedule", "LaLiga"),
        ("champions_schedule", "Champions"),
    ):
        try:
            events = get_events(URLS[key], competition)
            if events:
                merge_schedule(fixtures, events)
                successes += 1
                log(f"{competition}: {len(events)} eventos recibidos")
            else:
                log(f"{competition}: la fuente no devolvió eventos")
        except Exception as exc:
            log(f"AVISO {competition} calendario: {exc}")

    # Si un partido ya pasó pero el endpoint de calendario no trae el estado
    # final, hacemos una consulta específica al marcador del día.
    repair_past_results(fixtures)

    # Orden cronológico.
    fixtures.sort(key=lambda x: (x.get("date") or "9999-99-99", x.get("time") or "99:99"))

    # Clasificación LaLiga
    try:
        rows = parse_standings(fetch_json(URLS["laliga_standings"]))
        if len(rows) >= 18:
            data["laligaStandings"] = rows
            successes += 1
            log(f"LaLiga: clasificación actualizada ({len(rows)} equipos)")
        else:
            log("AVISO: clasificación de LaLiga incompleta; se conserva la anterior")
    except Exception as exc:
        log(f"AVISO clasificación LaLiga: {exc}")

    # Clasificación Champions
    try:
        rows = parse_standings(fetch_json(URLS["champions_standings"]))
        if len(rows) >= 24:
            data["championsStandings"] = rows
            data["championsStandingsStatus"] = "active"
            successes += 1
            log(f"Champions: clasificación actualizada ({len(rows)} equipos)")
        else:
            # Antes de empezar puede venir vacía.
            log("Champions: clasificación todavía no disponible/completa")
    except Exception as exc:
        log(f"AVISO clasificación Champions: {exc}")

    nxt = choose_next_match(fixtures)
    if nxt:
        data["nextMatch"] = nxt

    if successes == 0:
        log("No se pudo consultar ninguna fuente. Se deja el JSON intacto.")
        return 0

    if meaningful_snapshot(data) == meaningful_snapshot(original):
        log("Sin cambios reales.")
        return 0

    data.setdefault("app", {})["lastUpdated"] = datetime.now(TZ).isoformat(timespec="minutes")
    JSON_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    log("real_madrid.json actualizado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
