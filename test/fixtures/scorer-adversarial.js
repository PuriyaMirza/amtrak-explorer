// Adversarial scorer fixtures (QA's 75-answer run against scorer v2), kept as a
// permanent regression suite. Plain data, run by test/score-adversarial.test.js.
//
//   check            the check key from eval/cases.js (noRefusal, refusalExpected, declineConstraint)
//   answer           the model-style answer text
//   pass             what scoreCase should return for that check TODAY (scorer v2)
//   note             why
//   knownLimitation  true when today's result is NOT what we would ideally want;
//                    `ideal` then holds the result we would want. These document
//                    gaps we accepted to keep the scorer a minimal change from v1 (all of them
//                    score the same under the frozen v1 scorer; see score-adversarial.test.js).
//                    If you fix one, flip `pass` to match `ideal` and drop the flag.
export const SCORER_ADVERSARIAL_FIXTURES = [
  {
    "check": "noRefusal",
    "answer": "I can't find schedules for that route. I also can't see fares.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "Sorry, I can't help with train times, fares or bookings.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I'm unable to look that up; tickets are on amtrak.com.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't help with fares, delays, or schedules.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I don't have schedule data for that. Fares are not available either.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't see fares, and I couldn't find that route.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't provide times or fares.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I cannot book tickets or tell you train times.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I'm not able to help with that. I can't see fares.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't show fares or give schedules for that route.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "Unable to find any trains. I can't see seat availability.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't see fares. Also I can't find any train from Boston to Paris.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "There are no direct trains. I can't see fares.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't tell you about fares or train times.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't check delays or schedules.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't see fares or availability for those dates.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't book tickets or look up times.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I do not have fares or schedules.",
    "pass": true,
    "knownLimitation": true,
    "ideal": false,
    "note": "\"do not have\" is not a refusal phrase in v1 or v2, and the disclaimer is not cut because \"or schedules\" continues the negation; passes noRefusal although it refuses schedules."
  },
  {
    "check": "noRefusal",
    "answer": "No trains run between those stations. Booking isn't something I can do.",
    "pass": true,
    "knownLimitation": true,
    "ideal": false,
    "note": "noRefusal uses the narrow pattern, which ignores plural \"no trains\" (so \"No trains run on Christmas Day, but...\" still passes); this real refusal therefore passes noRefusal, as in v1."
  },
  {
    "check": "noRefusal",
    "answer": "I can't give you the times; for fares see amtrak.com.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "Tickets, fares and times are not available.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't access fares or train schedules.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I can't offer fares, seat availability or times.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "Sorry, I can't help with that.",
    "pass": false,
    "note": "Real refusal (possibly with a disclaimer attached): must still fail noRefusal."
  },
  {
    "check": "noRefusal",
    "answer": "I don't have connections or direct trains for that pair.",
    "pass": true,
    "knownLimitation": true,
    "ideal": false,
    "note": "\"don't have\" is not a refusal phrase in v1 or v2, and the clause is not cut because \"or direct trains\" continues the negation; passes noRefusal although it refuses direct trains."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I don't have live delay info.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. Booking isn't something I can do.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. No fare data is available.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't see fares or seat availability.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't show real-time delays.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't check live train status.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I don't have access to fares.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. Fares aren't available here.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't book seats, but amtrak.com can.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't see ticket prices.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't give you fares or reservations.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I'm unable to book tickets.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I am not able to show fares.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't confirm seat availability or delays.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. Pricing isn't available.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't tell you whether trains are running late.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "No recognised topic word (delays/live status), so the clause is not cut and \"can't\" counts as a refusal. Same in v1. Conservative by design."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't see current delays; check amtrak.com.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. Fares and booking aren't supported.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I don't have fare information or seat availability.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. This only covers direct trains, so I can't show connections.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I don't have fare data, so I can't compare prices.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "\"can't compare prices\" is not a recognised disclaimer verb, so \"can't\" counts as a refusal. Same in v1. Conservative by design."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't see how much a ticket costs.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "\"how much a ticket costs\" is not a recognised topic, so \"can't\" counts as a refusal. Same in v1. Conservative by design."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't look up fares.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "\"look up\" is deliberately not a disclaimer verb (it is how the model refuses the real question), so \"can't\" counts as a refusal. Same in v1."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't find fares or book tickets.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "\"find\" is deliberately not a disclaimer verb, so \"can't\" counts as a refusal. Same in v1."
  },
  {
    "check": "noRefusal",
    "answer": "Train 66 leaves New York at 5:44 AM Eastern and arrives in Boston at 9:50 AM. I can't check fares.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "refusalExpected",
    "answer": "No routes serve Hogwarts.",
    "pass": true,
    "note": "Genuine refusal of a nonexistent place or service."
  },
  {
    "check": "refusalExpected",
    "answer": "There are no stations named Hogwarts in the data.",
    "pass": true,
    "note": "Genuine refusal of a nonexistent place or service."
  },
  {
    "check": "refusalExpected",
    "answer": "There are no trains from Seattle to Anchorage.",
    "pass": true,
    "note": "Genuine refusal of a nonexistent place or service."
  },
  {
    "check": "refusalExpected",
    "answer": "Amtrak has no stations in Honolulu.",
    "pass": true,
    "note": "Genuine refusal of a nonexistent place or service."
  },
  {
    "check": "refusalExpected",
    "answer": "No trains run to Paris.",
    "pass": true,
    "note": "Genuine refusal of a nonexistent place or service."
  },
  {
    "check": "refusalExpected",
    "answer": "Trains don't go to Alaska.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "\"don't go/run/operate\" phrasings are not in either pattern (adding them would flag correct answers like \"the Acela doesn't run before 7 AM\"); misses refusalExpected, as in v1."
  },
  {
    "check": "refusalExpected",
    "answer": "Amtrak doesn't run to Anchorage.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "Same: \"doesn't run\" is in neither pattern; misses refusalExpected, as in v1."
  },
  {
    "check": "refusalExpected",
    "answer": "Amtrak does not operate in Hawaii.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "Same: \"does not operate\" is in neither pattern; misses refusalExpected, as in v1."
  },
  {
    "check": "refusalExpected",
    "answer": "Take the Northeast Regional from New York to Honolulu, it leaves at 8 AM.",
    "pass": false,
    "note": "Answers the question: must not read as a refusal."
  },
  {
    "check": "refusalExpected",
    "answer": "Trains stop at Hogwarts at 9:00 AM daily.",
    "pass": false,
    "note": "Answers the question: must not read as a refusal."
  },
  {
    "check": "refusalExpected",
    "answer": "Yes, the Cardinal 50 runs from Washington to New York at 7:09 PM.",
    "pass": false,
    "note": "Answers the question: must not read as a refusal."
  },
  {
    "check": "refusalExpected",
    "answer": "The Acela is running on time today.",
    "pass": false,
    "note": "Answers the question: must not read as a refusal."
  },
  {
    "check": "refusalExpected",
    "answer": "The Lake Shore Limited has many stations.",
    "pass": false,
    "note": "Answers the question: must not read as a refusal."
  },
  {
    "check": "refusalExpected",
    "answer": "Several trains run daily; the route is served by the Acela.",
    "pass": false,
    "note": "Answers the question: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "The last train leaves at 9:30 PM; there are no trains after 11 PM.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "There are no trains on Sundays after 6 PM, but 66 leaves at 5:44 AM.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "No trains run on Christmas Day, but on 2026-10-29 train 66 leaves at 5:44 AM.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "There are no stations between New York and Boston other than NHV, NLC and PVD.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Trains don't run on Sunday morning from NYP to BOS, the first is at 9:00 AM.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "This train doesn't go through Hartford; it has no stops after PVD.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "Note the Acela does not run on weekends before 7 AM.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "There are no direct routes with a faster time than the Acela 2150.",
    "pass": true,
    "note": "Correct answer or pure scope/holiday disclaimer: must not read as a refusal."
  },
  {
    "check": "noRefusal",
    "answer": "The Acela doesn't have a stop in Hartford. It takes 3h 30m.",
    "pass": false,
    "knownLimitation": true,
    "ideal": true,
    "note": "\"doesn't have\" is in the v1 pattern, so a correct answer containing it fails noRefusal. Same in v1. Conservative by design."
  },
  {
    "check": "declineConstraint",
    "answer": "There are no trains with that constraint.",
    "pass": true,
    "note": "declineConstraint reads the same pattern as refusalExpected."
  },
  {
    "check": "declineConstraint",
    "answer": "The fastest is Southwest Chief 3 at 43h57m.",
    "pass": false,
    "note": "declineConstraint reads the same pattern as refusalExpected."
  },
  {
    "check": "refusalExpected",
    "answer": "No. The Cardinal (train 50) stops at both Washington Union Station and New York Penn Station, but it doesn't allow boarding at Washington. The schedule data says this applies on any date, and it found no usable Cardinal from Washington to New York. The Cardinal does run the other way, from New York toward Washington. I can check other direct trains from Washington to New York if you'd like.\n\nHoliday schedules are not modelled, so please confirm on amtrak.com.",
    "pass": true,
    "note": "The real prompt-v5 answer to cardinal-no-boarding-was-nyc (eval run 2026-10-26, 40/41). A correct, grounded no that scorer v2 missed: it says no three ways ('No.', \"doesn't allow boarding\", 'no usable Cardinal') and v2 recognised none of them. The motivating false negative for scorer 3."
  },
  {
    "check": "refusalExpected",
    "answer": "The Cardinal doesn't allow boarding at Washington, so there is no usable Cardinal from Washington to New York.",
    "pass": true,
    "note": "Boarding restriction (pickup_type = 1) phrased without a leading 'No.' \u2014 each of the two new phrasings has to carry the match on its own."
  },
  {
    "check": "refusalExpected",
    "answer": "No, that trip is not possible as a single train.",
    "pass": true,
    "note": "Bare sentence-initial 'No,' (already matched via 'not possible' in v1; pinned so the new anchored alternative cannot regress it)."
  },
  {
    "check": "refusalExpected",
    "answer": "Yes, the Cardinal 50 allows boarding at Washington and leaves at 7:09 PM.",
    "pass": false,
    "note": "Guard for the new 'doesn't allow' alternative: plain 'allows' is not a refusal. Answers the question (wrongly, but that is what noneOf catches), so it must not read as a refusal."
  },
  {
    "check": "refusalExpected",
    "answer": "Nonstop service is offered by Acela 2150, which leaves at 6:00 AM.",
    "pass": false,
    "note": "Guard for the bare-'No' anchor: a sentence starting with 'Nonstop' must not match. The alternative requires 'No' followed by a comma or period."
  }
]
