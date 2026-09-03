#!/usr/bin/env python3
"""
Madridista · actualización automática con directo y clasificación provisional.

Modos:
- Normal (cada hora): revisa calendario, resultados, clasificaciones oficiales y
  prepara las ventanas de seguimiento de los partidos del día.
- --live-only (cada 5 min): solo trabaja si estamos dentro de una ventana de
  partido. Actualiza marcadores en directo y calcula clasificaciones provisionales.

Fuente: endpoints públicos de ESPN. No necesita claves ni secretos.
La TV española se conserva del JSON existente.
"""
from __future__ import annotations

import argparse
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
        "User-Agent": "Mozilla/5.0 (compatible; MadridistaUpdater/2.0; +https://github.com/)",
        "Accept": "application/json,text/plain,*/*",
    })
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


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
    match_status = "finished" if completed else ("live" if state == "in" else "scheduled")

    home_team = home.get("team") or {}
    away_team = away.get("team") or {}
    hs, aws = score_number(home), score_number(away)

    return {
        "eventId": str(evt.get("id", "")),
        "competition": competition_name,
        "date": dt.date().isoformat(),
        "displayDate": display_date(dt),
        "time": dt.strftime("%H:%M"),
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
        for key in ("date", "displayDate", "time", "venue"):
            if event.get(key) is not None:
                fx[key] = event[key]

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

        # La tabla provisional se calcula únicamente con partidos EN JUEGO.
        # Al finalizar, dejamos que la clasificación oficial absorba el resultado.
        relevant = [ev for ev in all_by_comp[competition] if ev.get("status") == "live"]
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
            "pendingOfficialGames": 0,
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

    nxt = choose_next_match(data.get("fixtures") or [])
    if nxt:
        data["nextMatch"] = nxt

    if successes <= 0:
        log("No hubo datos válidos para actualizar.")
        return 0

    if meaningful_snapshot(data) == meaningful_snapshot(original):
        log("Sin cambios reales.")
        return 0

    data.setdefault("app", {})["lastUpdated"] = datetime.now(TZ).isoformat(timespec="minutes")
    JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log("real_madrid.json actualizado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
