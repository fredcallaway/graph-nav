import {numString, markdown, makePromise, parseHTML, trialErrorHandling, graphicsUrl, setTimeoutPromise, addPlugin, documentEventPromise, invariant} from './utils.js';
import _ from '../../lib/underscore-min.js';
import $ from '../../lib/jquery-min.js';
import jsPsych from '../../lib/jspsych-exported.js';
import {bfs} from './graphs.js';

const BLOCK_SIZE = 100;
// replace BLOCK_SIZE with hi=parseHTML('<div class="State" style="display: block;position: fixed;left: 200vw;"></div>');document.body.append(hi);console.log(hi.offsetWidth);hi.remove();console.log(hi.offsetWidth)

export class CircleGraph {
  constructor(options) {

    if (options.dynamicProperties) {
      Object.assign(options, options.dynamicProperties());
    }
    options.graphics = options.reward.map(x => options.rewardGraphics[x])

    this.options = options;
    options.edgeShow = options.edgeShow || (() => true);
    options.successorKeys = options.graphRenderOptions.successorKeys;
    let gro = options.graphRenderOptions;
    // We have a rendering function for keys. Defaults to identity for keys that can be rendered directly.
    gro.successorKeysRender = gro.successorKeysRender || (key => key);

    this.el = parseHTML(renderCircleGraph(
      options.graph, options.graphics, options.goal,
      {
        edgeShow: options.edgeShow,
        successorKeys: options.successorKeys,
        probe: options.probe,
        ...options.graphRenderOptions,
      }
    ));
    if (options.hide_states) {
    }
    this.setCurrentState(options.start);

    // Making sure it is easy to clean up event listeners...
    this.cancellables = [];
  }

  enableMouseTracking(logger, edges=false, rewards=false) {
    if (rewards) this.el.classList.add('hideStates');
    if (edges) this.el.classList.add('hideEdges');

    for (const el of this.el.querySelectorAll('.State')) {
      const state = parseInt(el.getAttribute('data-state'), 10);
      el.addEventListener('mouseenter', (e) => {
        logger('mouseenter', {state})
        el.classList.add('is-visible');
        for (const successor of this.options.graph.successors(state)) {
          queryEdge(this.el, state, successor).classList.add('is-visible');
        }
      });
      el.addEventListener('mouseleave', (e) => {
        logger('mouseleave', {state})
        el.classList.remove('is-visible');
        for (const successor of this.options.graph.successors(state)) {
          queryEdge(this.el, state, successor).classList.remove('is-visible');
        }
      });
    }
  }

  cancel() {
    // Use this for early termination of the graph.
    // Only used during free-form graph navigation.
    for (const c of this.cancellables) {
      c();
    }
    this.cancellables = [];
  }

  setCurrentState(state, options) {
    this.state = state;
    setCurrentState(this.el, this.options.graph, this.state, {
      edgeShow: this.options.edgeShow,
      successorKeys: this.options.successorKeys,
      onlyShowCurrentEdges: this.options.graphRenderOptions.onlyShowCurrentEdges,
      ...options,
    });
  }

  keyCodeToState(keyCode) {
    /*
    Mapping keyCode to states.
    */
    const key = String.fromCharCode(keyCode).toUpperCase();
    const idx = this.options.successorKeys[this.state].indexOf(key);
    if (idx === -1) {
      return null;
    }
    const succ = this.options.graph.successors(this.state)[idx];
    if (!this.options.edgeShow(this.state, succ)) {
      return null;
    }
    return succ;
  }

  keyTransition() {
    /*
    Returns a promise that is resolved with {state} when there is a keypress
    corresponding to a valid state transition.
    */
    const p = documentEventPromise('keydown', (e) => {
      const state = this.keyCodeToState(e.keyCode);
      if (state !== null) {
        e.preventDefault();
        return {state};
      }
    });

    this.cancellables.push(p.cancel);

    return p;
  }

  clickTransition(options) {
    options = options || {};
    /*
    Returns a promise that is resolved with {state} when there is a click
    corresponding to a valid state transition.
    */
    const invalidStates = new Set(options.invalidStates || [this.state, this.options.goal]);

    for (const s of this.options.graph.states) {
      const el = this.el.querySelector(`.GraphNavigation-State-${s}`);
      if (invalidStates.has(s)) {
        el.classList.remove('PathIdentification-selectable');
      } else {
        el.classList.add('PathIdentification-selectable');
      }
    }

    return new Promise((resolve, reject) => {
      const handler = (e) => {
        const el = $(e.target).closest('.PathIdentification-selectable').get(0);
        if (!el) {
          return;
        }
        e.preventDefault();
        const state = parseInt(el.getAttribute('data-state'), 10);

        this.el.removeEventListener('click', handler);
        resolve({state});
      }

      this.el.addEventListener('click', handler);
    });
  }

  async navigate(options) {
    options = options || {};
    const termination = options.termination || ((state) => state == this.options.goal);
    let stepsLeft = options.n_steps || -1;
    const onStateVisit = options.onStateVisit || ((s) => {});

    onStateVisit(this.state, stepsLeft); // We have to log the initial state visit.
    while (true) { // eslint-disable-line no-constant-condition
      // State transition
      const g = this.options.graph;
      const {state} = await this.clickTransition({
        invalidStates: new Set(
          g.states.filter(s => !g.successors(this.state).includes(s))
        ),
      });
      stepsLeft -= 1;
      onStateVisit(state, stepsLeft);

      this.setCurrentState(state);

      if (termination(state) || stepsLeft == 0) {
        $(".GraphNavigation-currentEdge").removeClass('GraphNavigation-currentEdge')
        break;
      }
      await setTimeoutPromise(200);
    }
  }

  setXY(xy) {
    /*
    This function is a pretty big hack only intended for use when animating between
    the two projections. Given an XY object with properties coordinate (for states) and scaled
    (for edges/keys), it updates the coordinates of the rendered graph.
    */

    // We cache these references since we know this will be called many times.
    if (!this._setXY_states) {
      this._setXY_states = Array.from(this.el.querySelectorAll('.State'));
      this._setXY_edges = {};
      const graph = this.options.graph;
      for (const s of graph.states) {
        this._setXY_edges[s] = {};
        for (const ns of this.options.graph.successors(s)) {
          if (s >= ns) {
            continue;
          }
          this._setXY_edges[s][ns] = this.el.querySelector(`.GraphNavigation-edge-${s}-${ns}`);
        }
      }
    }

    for (const el of this._setXY_states) {
      // Set the coordinate for this state.
      const s = parseInt(el.dataset.state, 10);
      const [x, y] = xy.coordinate[s];
      el.style.transform = `translate(${x-BLOCK_SIZE/2}px, ${y-BLOCK_SIZE/2}px)`;

      // Set coordinates for edges
      for (const ns of this.options.graph.successors(s)) {
        if (s >= ns) {
          continue;
        }
        const e = normrot(xy.scaled[s], xy.scaled[ns]); // HACK we assume that there's no `edge` property.
        const edge = this._setXY_edges[s][ns];
        edge.style.width = `${e.norm}px`;
        edge.style.transform = `translate(${x}px,${y}px) rotate(${e.rot}rad)`;
      }
    }
  }
}

const stateTemplate = (state, graphic, options) => {
  let cls = `GraphNavigation-State-${state}`;
  if (options.goal) {
    cls += ' GraphNavigation-goal';
  }
  if (options.probe) {
    cls += ' GraphNavigation-probe';
  }
  return `
  <div class="State GraphNavigation-State ${cls || ''}" style="${options.style || ''}" data-state="${state}"><img src="${graphicsUrl(graphic)}" /></div>
  `;
};

export const renderSmallEmoji = (graphic, cls) => `
<span class="GraphNavigation withGraphic">
  <span style="position: relative; border-width:1px !important;width:4rem;height:4rem;display:inline-block;margin: 0 0 -0.5rem 0;" class="GraphNavigation-State State ${cls||''}">${graphic?`<img src="${graphicsUrl(graphic)}" />`:''}</span>
</span>
`;

function keyForCSSClass(key) {
  // Using charcode here, for unrenderable keys like arrows.
  return key.charCodeAt(0);
}

function graphXY(graph, width, height, scaleEdgeFactor, fixedXY) {
  /*
  This function computes the pixel placement of nodes and edges, given the parameters.
  */
  invariant(0 <= scaleEdgeFactor && scaleEdgeFactor <= 1);

  // We make sure to bound our positioning to make sure that our blocks are never cropped.
  const widthNoMargin = width - BLOCK_SIZE;
  const heightNoMargin = height - BLOCK_SIZE;

  // We compute bounds for each dimension.
  const maxX = Math.max.apply(null, fixedXY.map(xy => xy[0]));
  const minX = Math.min.apply(null, fixedXY.map(xy => xy[0]));
  const rangeX = maxX-minX;
  const maxY = Math.max.apply(null, fixedXY.map(xy => xy[1]));
  const minY = Math.min.apply(null, fixedXY.map(xy => xy[1]));
  const rangeY = maxY-minY;

  // We determine the appropriate scaling factor for the dimensions by comparing the
  // aspect ratio of the bounding box of the embedding with the aspect ratio of our
  // rendering viewport.
  let scale;
  if (rangeX/rangeY > widthNoMargin/heightNoMargin) {
    scale = widthNoMargin / rangeX;
  } else {
    scale = heightNoMargin / rangeY;
  }

  // We can now compute an appropriate margin for each dimension that will center our graph.
  let marginX = (width - rangeX * scale) / 2;
  let marginY = (height - rangeY * scale) / 2;

  // Now we compute our coordinates.
  const coordinate = {};
  const scaled = {};
  for (const state of graph.states) {
    let [x, y] = fixedXY[state];
    // We subtract the min, rescale, and offset appropriately.
    x = (x-minX) * scale + marginX;
    y = (y-minY) * scale + marginY;
    coordinate[state] = [x, y];
    // We rescale for edges/keys by centering over the origin, scaling, then translating to the original position.
    scaled[state] = [
      (x - width/2) * scaleEdgeFactor + width/2,
      (y - height/2) * scaleEdgeFactor + height/2,
    ];
  }

  return {
    coordinate,
    scaled,
    edge(state, successor) {
      return normrot(scaled[state], scaled[successor]);
    },
  };
}

function normrot([x, y], [sx, sy]) {
  // This function returns the length/norm and angle of rotation
  // needed for a line starting at [x, y] to end at [sx, sy].
  const norm = Math.sqrt(Math.pow(x-sx, 2) + Math.pow(y-sy, 2));
  const rot = Math.atan2(sy-y, sx-x);
  return {norm, rot};
}

function renderCircleGraph(graph, gfx, goal, options) {
  options = options || {};
  options.edgeShow = options.edgeShow || (() => true);
  const successorKeys = options.successorKeys;
  /*
  fixedXY: Optional parameter. This requires x,y coordinates that are in
  [-1, 1]. The choice of range is a bit arbitrary; results from code that assumes
  the output of sin/cos.
  */
  // Controls how far the key is from the node center. Scales keyWidth/2.
  const keyDistanceFactor = options.keyDistanceFactor || 1.4;

  const width = options.width;
  const height = options.height;

  const xy = graphXY(
    graph,
    width, height,
    // Scales edges and keys in. Good for when drawn in a circle
    // since it can help avoid edges overlapping neighboring nodes.
    options.scaleEdgeFactor || 0.95,
    options.fixedXY,
  );

  const states = graph.states.map(state => {
    const [x, y] = xy.coordinate[state];
    return stateTemplate(state, gfx[state], {
      probe: state == options.probe,
      goal: state == goal,
      style: `transform: translate(${x - BLOCK_SIZE/2}px,${y - BLOCK_SIZE/2}px);`,
    });
  });

  const succ = [];
  const keys = [];
  for (const state of graph.states) {
    let [x, y] = xy.scaled[state];
    graph.successors(state).forEach((successor, idx) => {
      if (state >= successor) {
        return;
      }
      const e = xy.edge(state, successor);
      // const opacity = options.edgeShow(state, successor) ? 1 : 0;
      // opacity: ${opacity};
      succ.push(`
        <div class="GraphNavigation-edge GraphNavigation-edge-${state}-${successor}" style="
        width: ${e.norm}px;
        transform: translate(${x}px,${y}px) rotate(${e.rot}rad);
        "></div>
      `);

      // We also add the key labels here
      // addKey(successorKeys[state][idx], state, successor, e.norm);
      // addKey(successorKeys[successor][graph.successors(successor).indexOf(state)], successor, state, e.norm);
    });
  }

  return `
  <div class="GraphNavigation withGraphic" style="width: ${width}px; height: ${height}px;">
    <div class="GraphNavigation-header-left">
      <div id="gn-steps" style="display: none;">
        Steps: <span class="GraphNavigation-header-value" id="GraphNavigation-steps"></span> <br>
      </div>
      <div id="gn-points" style="display: none;">
        Points: <span class="GraphNavigation-header-value" id="GraphNavigation-points"></span>
      </div>
    </div>
    ${keys.join('')}
    ${succ.join('')}
    ${states.join('')}
  </div>
  `;
}

export function queryEdge(root, state, successor) {
  /*
  Returns the edge associated with nodes `state` and `successor`. Since we only
  have undirected graphs, they share an edge, so some logic is needed to find it.
  */
  if (state < successor) {
    return root.querySelector(`.GraphNavigation-edge-${state}-${successor}`);
  } else {
    return root.querySelector(`.GraphNavigation-edge-${successor}-${state}`);
  }
}

function setCurrentState(display_element, graph, state, options) {
  options = options || {};
  options.edgeShow = options.edgeShow || (() => true);
  // showCurrentEdges enables rendering of current edges/keys. This is off for PathIdentification and AcceptReject.
  options.showCurrentEdges = typeof(options.showCurrentEdges) === 'undefined' ? true : options.showCurrentEdges;
  const allKeys = _.unique(_.flatten(options.successorKeys));

  // Remove old classes!
  function removeClass(cls) {
    const els = display_element.querySelectorAll('.' + cls);
    for (const e of els) {
      e.classList.remove(cls);
    }
  }
  removeClass('GraphNavigation-current')
  removeClass('GraphNavigation-currentEdge')
  // removeClass('GraphNavigation-currentKey')
  for (const key of allKeys) {
    removeClass(`GraphNavigation-currentEdge-${keyForCSSClass(key)}`)
    // removeClass(`GraphNavigation-currentKey-${keyForCSSClass(key)}`)
  }

  // Can call this to clear out current state too.
  if (state == null) {
    return;
  }

  // Add new classes! Set current state.
  display_element.querySelector(`.GraphNavigation-State-${state}`).classList.add('GraphNavigation-current');

  if (!options.showCurrentEdges) {
    return;
  }

  if (options.onlyShowCurrentEdges) {
    // for (const el of display_element.querySelectorAll('.GraphNavigation-edge,.GraphNavigation-key')) {
    for (const el of display_element.querySelectorAll('.GraphNavigation-edge')) {
      el.style.opacity = 0;
    }
  }

  graph.successors(state).forEach((successor, idx) => {
    if (!options.edgeShow(state, successor)) {
      return;
    }

    // Set current edges
    let el = queryEdge(display_element, state, successor);
    el.classList.add('GraphNavigation-currentEdge');
    // el.classList.add(`GraphNavigation-currentEdge-${keyForCSSClass(successorKeys[idx])}`);
    if (options.onlyShowCurrentEdges) {
      el.style.opacity = 1;
    }

    // Now setting active keys
    // el = display_element.querySelector(`.GraphNavigation-key-${state}-${successor}`);
    // el.classList.add('GraphNavigation-currentKey');
    // el.classList.add(`GraphNavigation-currentKey-${keyForCSSClass(successorKeys[idx])}`);
    // if (options.onlyShowCurrentEdges) {
    //   el.style.opacity = 1;
    // }
  });
}

async function waitForSpace() {
  return documentEventPromise('keypress', (e) => {
    if (e.keyCode == 32) {
      e.preventDefault();
      return true;
    }
  });
}

function endTrialScreen(root, msg) {
  root.innerHTML = `<h2 style="margin-top: 20vh;margin-bottom:100vh;">${msg || ''}Press spacebar to continue.</h2>`;
  return waitForSpace();
}

function renderKeyInstruction(keys) {
  function renderInputInstruction(inst) {
    return `<span style="border: 1px solid black; border-radius: 3px; padding: 3px; font-weight: bold; display: inline-block;">${inst}</span>`;
  }

  if (keys.accept == 'Q') {
    return `${renderInputInstruction('Yes (q)')} &nbsp; ${renderInputInstruction('No (p)')}`;
  } else {
    return `${renderInputInstruction('No (q)')} &nbsp; ${renderInputInstruction('Yes (p)')}`;
  }
}

addPlugin('CircleGraphNavigation', trialErrorHandling(async function(root, trial) {
  console.log('trial', trial);
  const cg = new CircleGraph(trial);


  root.innerHTML = ""
  root.appendChild(cg.el);

  let data = {
    events: [],
    trial: _.pick(trial, 'practice', 'start', 'reward')
  }
  let start_time = Date.now()
  function logger(event, info={}) {
    console.log(event, info)
    data.events.push({
      time: Date.now() - start_time,
      event,
      ...info
    });
  }

  cg.enableMouseTracking(logger, trial.hover_edges, trial.hover_rewards)

  let score = 0
  await cg.navigate({
    onStateVisit(state, stepsLeft) {
      if (stepsLeft != trial.n_steps) {
        score += trial.reward[state]
      }
      logger('visit', {state})
      console.log(stepsLeft)
      $("#GraphNavigation-steps").html(stepsLeft)
      $("#GraphNavigation-points").html(score)
    },
    n_steps: trial.n_steps
  });
  logger('done')
  await setTimeoutPromise(2000);
  await endTrialScreen(root);

  root.innerHTML = '';
  console.log(data);
  jsPsych.finishTrial(data);
}));