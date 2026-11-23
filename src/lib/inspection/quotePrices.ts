/**
 * Standard pricing for the automatic repair quote.
 *
 * Each repair item on an inspection report is matched against RULES, top to
 * bottom; the first rule whose `item` (and `note`, if given) matches wins.
 * `hrs` is field labor for the line, `cost` is DESHAZO's parts cost. The quote
 * shows parts at cost ÷ PARTS_DIVISOR and labor at LABOR_RATE per hour.
 * Change the numbers here to tune every future quote.
 */

export const LABOR_RATE = 110
export const PARTS_DIVISOR = 0.71

export type Priority = 'critical' | 'high' | 'medium' | 'low'

export type Rule = {
  /** matched against the report's item name, e.g. "Wire Rope/Chain Condition" */
  item: RegExp
  /** optional: also must match the inspector's note */
  note?: RegExp
  /** customer-facing line; {item} is replaced with the report's item name */
  desc: string
  hrs: number
  cost: number
  priority: Priority
}

const NOT_WORKING = /not work|doesn'?t work|do not work|inoperable|no brake|won'?t stop|failed/i

export const RULES: Rule[] = [
  // Brakes
  { item: /brake/i, note: NOT_WORKING, desc: 'Replace {item} (not working)', hrs: 6, cost: 1400, priority: 'critical' },
  { item: /^motors?$/i, note: /brake|break/i, desc: 'Replace motor brakes (brakes not working)', hrs: 6, cost: 1400, priority: 'critical' },
  { item: /brake/i, desc: 'Adjust / reline {item}', hrs: 3, cost: 350, priority: 'high' },

  // Hoist rope, chain, hook and block
  { item: /wire rope|rope\/chain|chain condition/i, note: /chain/i, desc: 'Replace hoist load chain', hrs: 4, cost: 600, priority: 'high' },
  { item: /wire rope|rope\/chain|chain condition/i, desc: 'Replace hoist wire rope', hrs: 6, cost: 800, priority: 'high' },
  { item: /hook|block/i, note: /latch/i, desc: 'Replace hook safety latch', hrs: 0.5, cost: 25, priority: 'high' },
  { item: /hook|block/i, note: /sheave|spacer|bearing/i, desc: 'Rebuild lower block (sheaves / spacer / bearings)', hrs: 6, cost: 900, priority: 'high' },
  { item: /hook|block/i, desc: 'Replace hook / lower block components', hrs: 3, cost: 500, priority: 'high' },
  { item: /sheave/i, desc: 'Replace {item}', hrs: 5, cost: 700, priority: 'high' },
  { item: /limit/i, desc: 'Repair / replace {item}', hrs: 3, cost: 450, priority: 'high' },

  // Electrical
  { item: /collector|shoe/i, desc: 'Replace collector shoes', hrs: 4, cost: 600, priority: 'high' },
  { item: /conductor|festoon/i, desc: 'Repair / re-route festoon and conductors', hrs: 4, cost: 150, priority: 'medium' },
  { item: /strain relief/i, desc: 'Install proper pendant strain relief', hrs: 1, cost: 40, priority: 'medium' },
  { item: /push button station|pendant/i, desc: 'Replace pendant push button station', hrs: 2, cost: 450, priority: 'high' },
  { item: /push button cable|pendant cable/i, desc: 'Replace pendant cable', hrs: 3, cost: 300, priority: 'medium' },
  { item: /remote/i, desc: 'Repair / replace radio remote control', hrs: 3, cost: 1200, priority: 'medium' },
  { item: /contactor|vfd/i, desc: 'Troubleshoot and repair {item} (parts after diagnosis)', hrs: 4, cost: 0, priority: 'high' },
  { item: /control panel/i, desc: 'Troubleshoot and repair {item} (parts after diagnosis)', hrs: 4, cost: 0, priority: 'high' },
  { item: /disconnect/i, desc: 'Replace {item}', hrs: 3, cost: 450, priority: 'high' },
  { item: /^motors?$/i, desc: 'Troubleshoot and repair motor (parts after diagnosis)', hrs: 4, cost: 0, priority: 'high' },
  { item: /horn|light/i, desc: 'Repair / replace {item}', hrs: 1.5, cost: 150, priority: 'low' },
  { item: /warning sign|rated load|capacity rating|marking/i, desc: 'Furnish and install {item}', hrs: 1, cost: 60, priority: 'medium' },

  // Mechanical / structure
  { item: /wheel bearing|bearing/i, desc: 'Replace {item}', hrs: 6, cost: 500, priority: 'high' },
  { item: /wheel/i, desc: 'Replace {item}', hrs: 8, cost: 900, priority: 'high' },
  { item: /gear box|gearbox|fluid|gasket|seal/i, desc: 'Service {item}', hrs: 3, cost: 150, priority: 'medium' },
  { item: /coupling|drive line|shaft/i, desc: 'Repair / replace {item}', hrs: 4, cost: 400, priority: 'high' },
  { item: /bumper/i, desc: 'Replace {item}', hrs: 2, cost: 150, priority: 'medium' },
  { item: /end stop|stops/i, desc: 'Fabricate and install {item}', hrs: 4, cost: 250, priority: 'high' },
  { item: /rail sweep/i, desc: 'Replace {item}', hrs: 2, cost: 120, priority: 'medium' },
  { item: /guard|cover|housing/i, desc: 'Repair / replace {item}', hrs: 2, cost: 150, priority: 'medium' },
  { item: /runway|rail|beam|girder|bolt|clip|connection/i, desc: 'Repair {item} (survey on site)', hrs: 4, cost: 0, priority: 'high' },
]

/** Anything no rule covers: a site visit line with no parts priced yet. */
export const FALLBACK: Omit<Rule, 'item'> = { desc: 'Repair {item} (parts after site review)', hrs: 2, cost: 0, priority: 'medium' }

/** Words in a note that make a line critical no matter what the rule says. */
export const CRITICAL = /do not operate|don'?t operate|not to operate|tag(ged)?[- ]?out|lock(ed)?[- ]?out|unsafe|out of service|critical/i
