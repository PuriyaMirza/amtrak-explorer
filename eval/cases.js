// Hand-written eval cases for /api/ask.
//
// Each case is one question plus a set of checks run against the response.
// Checks are declared per-case — a case only runs the checks relevant to it,
// rather than forcing every case through every kind of check.
//
// Check types:
//   anyOfGroups: [[...], [...]]
//     Every group must have at least one string that appears (case-
//     insensitive substring) in the answer. Multiple groups are AND'd
//     together; the strings within a group are OR'd. Use this to check
//     real stations/routes are actually named — it's the "stations exist"
//     criterion from the roadmap.
//   noneOf: [...]
//     None of these strings should appear in the answer. For flagging a
//     hallucinated station/route we know isn't real.
//   refusalExpected: true
//     The answer should read as a refusal (see REFUSAL_PATTERN in
//     score.js). This is the "correct refusals" criterion — for questions
//     with no real answer in the data (nonexistent places, no rail link).
//   declineConstraint: true
//     Same refusal-style check, used instead of refusalExpected when the
//     case is really testing "constraints respected" — the app has no
//     duration/time/scenery data, so it should say so instead of guessing.
//   toolQueriesInclude: [...]
//     At least one of the search_trains queries Claude actually issued
//     should contain this substring. Confirms the model is grounding its
//     answer in a real search rather than answering from pretraining.
//
// NOT YET TESTABLE: "arrival after departure" from the roadmap's scoring
// criteria needs itinerary/schedule data search_trains doesn't expose yet
// (see "Richer trip search" in CLAUDE.md's parked ideas). No case here
// fakes that check — it stays absent until the data exists to check it
// honestly.
//
// Every expectation below was verified against the live /api/ask endpoint
// before being written down here, not guessed from GTFS conventions.

export const CASES = [
  {
    id: 'chicago-routes-through',
    category: 'easy',
    question: 'What trains go through Chicago?',
    checks: {
      anyOfGroups: [
        ['Southwest Chief', 'Lake Shore Limited', 'California Zephyr', 'Texas Eagle', 'Empire Builder'],
      ],
      toolQueriesInclude: ['chicago'],
    },
  },
  {
    id: 'los-angeles-routes',
    category: 'easy',
    question: 'What trains serve Los Angeles?',
    checks: {
      anyOfGroups: [
        ['Coast Starlight', 'Southwest Chief', 'Sunset Limited', 'Pacific Surfliner'],
      ],
      toolQueriesInclude: ['los angeles'],
    },
  },
  {
    id: 'acela-stations',
    category: 'easy',
    question: 'Tell me about the Acela',
    checks: {
      anyOfGroups: [['Boston'], ['Washington']],
      toolQueriesInclude: ['acela'],
    },
  },
  {
    id: 'new-york-naming-quirk',
    category: 'ambiguous',
    question: 'What trains go through New York?',
    // The feed names this station "Ny Moynihan Train Hall At Penn Station" —
    // a literal "New York" substring search finds nothing on its own. This
    // case checks that the multi-round tool loop lets Claude retry with a
    // different phrasing rather than giving up or returning blank.
    checks: {
      anyOfGroups: [['Moynihan', 'Penn Station']],
      toolQueriesInclude: ['new york'],
    },
  },
  {
    id: 'washington-town-vs-dc',
    category: 'ambiguous',
    question: 'What trains serve Washington?',
    // Two real stations match "Washington": Washington Union Station (DC)
    // and a "Washington Amtrak Station" in the Central time zone (Missouri,
    // not DC). This checks both get surfaced, not just the first match.
    checks: {
      anyOfGroups: [['Union Station'], ['Missouri', 'Central']],
      toolQueriesInclude: ['washington'],
    },
  },
  {
    id: 'portland-or-vs-me',
    category: 'ambiguous',
    question: 'What trains serve Portland?',
    checks: {
      anyOfGroups: [['Oregon'], ['Maine']],
      toolQueriesInclude: ['portland'],
    },
  },
  {
    id: 'duration-constraint',
    category: 'ambiguous',
    question: 'What is the fastest train from Chicago to Los Angeles?',
    // The app has no schedule/duration data at all — this checks it admits
    // that instead of inventing a travel time, while still answering the
    // part it can (which routes connect the two cities).
    checks: {
      declineConstraint: true,
      anyOfGroups: [['Southwest Chief']],
    },
  },
  {
    id: 'honolulu-refusal',
    category: 'adversarial',
    question: 'What train should I take from NYC to Honolulu?',
    checks: {
      refusalExpected: true,
      toolQueriesInclude: ['honolulu'],
    },
  },
  {
    id: 'nonexistent-station',
    category: 'adversarial',
    question: 'What trains stop at Shangri-La Station?',
    checks: {
      refusalExpected: true,
      toolQueriesInclude: ['shangri'],
    },
  },
]
