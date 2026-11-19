"use strict";

/* A supplier site as a state machine: every page is a state, every click or
 * navigation is a transition between states.
 *
 *   states: {
 *     cart:   { title, match: { url: /shoppingcart/i } },
 *     signIn: { title, match: { all: ["account.signInForm"] }, person: "sign_in" },
 *     review: { title, match: { all: ["review.submit"] }, enter: [{ do: "read", target: "review.total", as: "total" }] },
 *   },
 *   transitions: [
 *     { name: "checkout", from: ["cart"], to: ["signIn", "shipping", "review"], steps: [{ do: "click", target: "checkout.start" }] },
 *     { name: "submitOrder", from: ["review"], to: ["confirmation"], confirm: { message: "place_order", show: "total" }, steps: [...] },
 *     { name: "goCart", from: "*", to: ["cart"], steps: [{ do: "goto", url: "{{cart}}" }] },
 *   ]
 *
 * A state is recognised by `match` (its address and the targets that must or
 * must not be on the page; a list of matches means any of them). States are
 * tried in the order they are written, so put the most telling first.
 * `person` states are the person's to get past (sign in, a security check);
 * `stuck` names the hand-off when a transition leaves the page where it was
 * (a payment the app may not choose); `enter` steps run on arrival (reading
 * the total). A `quiet` person state (a security check) is one the app lets
 * go of while the person is on it: no protocol connection and no script of
 * the app's in the page, which is loaded again so the check sees an ordinary
 * browser. A transition's `steps` are ordinary runner steps. It is taken
 * on the way to a goal unless `auto: false` (then only an `act` step names
 * it), and `confirm` makes it wait for the person's yes first.
 *
 * The runner walks a machine with two steps (runner.js):
 *   { do: "walk", to: "review" }        - recognise the page, take the first
 *                                         transition on a shortest path, repeat
 *   { do: "act", name: "addToCart" }    - take one named transition here
 *
 * Validation here catches a machine that names a state, target or step that
 * doesn't exist, before anything runs. */

const UNKNOWN = "unknown";


function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}


function defineMachine(machine, { targets, actions }) {
  const names = Object.keys(machine.states || {});
  if (!names.length) throw new Error("A machine needs states");
  if (names.includes(UNKNOWN)) throw new Error(`"${UNKNOWN}" is reserved`);
  const knownTarget = (name, where) => {
    if (!targets[name]) throw new Error(`${where}: no target "${name}"`);
  };
  const checkSteps = (steps, where) => {
    for (const step of steps || []) {
      if (!actions.has(step.do) || ["walk", "act"].includes(step.do)) throw new Error(`${where}: bad step "${step.do}"`);
      for (const name of [step.target, step.when, step.unless, step.until, step.or].filter(Boolean)) knownTarget(name, where);
    }
  };

  const states = {};
  for (const [name, state] of Object.entries(machine.states)) {
    const matches = list(state.match);
    if (!matches.length) throw new Error(`State ${name} has no match`);
    for (const match of matches) {
      if (!match.url && !list(match.all).length) throw new Error(`State ${name}: a match needs a url or a target`);
      for (const target of [...list(match.all), ...list(match.none)]) knownTarget(target, `State ${name}`);
    }
    checkSteps(state.enter, `State ${name}`);
    if (!state.title?.en) throw new Error(`State ${name} has no title`);
    states[name] = Object.freeze({ ...state, name, match: matches });
  }

  const transitions = (machine.transitions || []).map((transition) => {
    const where = `Transition ${transition.name}`;
    if (!transition.name) throw new Error("A transition needs a name");
    const from = transition.from === "*" ? "*" : list(transition.from);
    for (const state of from === "*" ? [] : from) if (!states[state]) throw new Error(`${where}: no state "${state}"`);
    const to = list(transition.to);
    if (!to.length) throw new Error(`${where} goes nowhere`);
    for (const state of to) if (!states[state]) throw new Error(`${where}: no state "${state}"`);
    if (!transition.steps?.length) throw new Error(`${where} has no steps`);
    checkSteps(transition.steps, where);
    if (!transition.title?.en) throw new Error(`${where} has no title`);
    return Object.freeze({ auto: true, ...transition, from, to });
  });
  const byName = new Map(transitions.map((transition) => [transition.name, transition]));
  if (byName.size !== transitions.length) throw new Error("Transition names must be unique");

  return Object.freeze({ states: Object.freeze(states), order: names, transitions, byName });
}


/** Transitions that may leave `state` (UNKNOWN only has the "*" ones). The
 * page's own transitions come before the ones open from anywhere, so a
 * results page opens its part instead of searching again. */
function leaving(machine, state, { auto = true } = {}) {
  const usable = machine.transitions.filter((transition) => !auto || transition.auto);
  const own = state === UNKNOWN ? [] : usable.filter((transition) => transition.from !== "*" && transition.from.includes(state));
  return [...own, ...usable.filter((transition) => transition.from === "*")];
}


/** The first transition on a shortest path from `from` to any goal, or null.
 * Transitions out of person states are the person's, so paths don't pass
 * through them; a walk waits there instead. */
function nextTransition(machine, from, goals) {
  const wanted = new Set(goals);
  if (wanted.has(from)) return null;
  const seen = new Set([from]);
  const queue = leaving(machine, from).map((transition) => ({ transition, at: transition.to }));
  while (queue.length) {
    const { transition, at } = queue.shift();
    if (at.some((state) => wanted.has(state))) return transition;
    for (const state of at) {
      if (seen.has(state) || machine.states[state]?.person) continue;
      seen.add(state);
      for (const next of leaving(machine, state)) queue.push({ transition, at: next.to });
    }
  }
  return null;
}


/** Every target a state's matches look at, for one presence check. */
function matchTargets(machine) {
  const names = new Set();
  for (const name of machine.order) {
    for (const match of machine.states[name].match) {
      for (const target of [...list(match.all), ...list(match.none)]) names.add(target);
    }
  }
  return [...names];
}


/** Which state the page is in, from its address and which targets are on it. */
function recognise(machine, url, present) {
  for (const name of machine.order) {
    const state = machine.states[name];
    const hit = state.match.some((match) => (!match.url || match.url.test(url))
      && list(match.all).every((target) => present[target])
      && list(match.none).every((target) => !present[target]));
    if (hit) return name;
  }
  return UNKNOWN;
}


module.exports = { UNKNOWN, defineMachine, leaving, matchTargets, nextTransition, recognise };
