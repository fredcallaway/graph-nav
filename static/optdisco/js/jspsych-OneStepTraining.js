import {completeModal, trialErrorHandling} from './utils.js';

const stateTemplate = (state, graphic, isSucc) => `
<div class='State' data-state="${state}" data-issucc="${isSucc}">${graphic}</div>
`;

function render(graph, gfx, state, nDistractors) {
  let other_state_divs = [];
  let succ_states = graph.graph[state];
  // console.log(gfx[state] + ": " + _.map(succ_states, (s) => gfx[s]).join(""));
  let other_states = _.reject(graph.states, (s) => {return (s === state) || (_.includes(succ_states, s))});
  other_states = _.first(other_states, nDistractors);
  other_states = other_states.concat(succ_states);
  other_states = jsPsych.randomization.repeat(other_states, 1);
  for (const s of other_states) {
      if (_.includes(succ_states, s)) {
        other_state_divs.push(stateTemplate(s, gfx[s], true))
      }
      else {
        other_state_divs.push(stateTemplate(s, gfx[s], false))
      }
  }
  other_state_divs = other_state_divs.join("");
  let peek = `
    <button class="btn btn-primary Peek">Peek</button>
    <div>Reminder: To continue to the next stage, you need to answer 
    every association correctly without peeking.</div>
    `;
  return `
  <div class="GraphTraining">
    <div class="GraphTraining-state">
      <div>${stateTemplate(state, gfx[state])}</div>
    </div>
    <div id="GraphTraining-msg">Pick the associated pictures:</div>
    <div class="GraphTraining-other_states">
      ${other_state_divs}
    </div>
    ${nDistractors > 0 ? peek : ""}
  </div>
  `;
}

function showState(el, graph, graphics, start, nDistractors) {
  let resolve;
  let promise = new Promise(function(res, rej) {
    resolve = res;
  });

  let peeked = false;
  let success = true;
  let selected = [];

  el.innerHTML = render(graph, graphics, start, nDistractors);
  let succ_left = graph.graph[start];
  let other_states = el.querySelector('.GraphTraining-other_states').querySelectorAll('.State');


  let highlightSuccessorStates = function() {
    for (const s of other_states) {
      const state = parseInt(s.getAttribute('data-state'), 10);
      if (_.includes(succ_left, state)) {
        s.classList.add("SuccState");
      }
    }
  };
  let unhighlightSuccessorStates = function () {
    for (const s of other_states) {
      const state = parseInt(s.getAttribute('data-state'), 10);
      if (_.includes(succ_left, state)) {
        s.classList.remove("SuccState");
      }
    }
  };
  for (const s of other_states) {
    s.addEventListener('click', function(e) {
      e.preventDefault(); // HACK
      const state = parseInt(s.getAttribute('data-state'), 10);
      selected.push(state);
      if (_.includes(succ_left, state)) {
        s.classList.add("HighlightedState");
        succ_left = _(succ_left).reject(s => s === state);
      }
      else {
        s.classList.add("NonSuccState");
        document.getElementById("GraphTraining-msg").innerHTML = "Whoops, you made a mistake!";
        highlightSuccessorStates();
        setTimeout(unhighlightSuccessorStates, 500);
        success = false;
      }
      if (succ_left.length === 0) {
          let response_data = {
            state,
            peeked,
            selected,
            success
          };
          setTimeout(() => resolve(response_data), 1000);
      }
    });
  }

  let peek = el.querySelector(".Peek");
  peek.addEventListener('click', function(e) {
    e.preventDefault(); // HACK
    peeked = true;
    highlightSuccessorStates();
    setTimeout(unhighlightSuccessorStates, 200);
 });
  return promise;
}

jsPsych.plugins.OneStepTraining = (function() {
  var plugin = {};
  plugin.info = {
    name: 'OneStepTraining',
    parameters: {}
  };

  plugin.trial = trialErrorHandling(async function(display_element, trial) {
    console.log(trial);

    const startTime = Date.now();
    const data = {
      times: [],
      responses: []
    };
    /*
    TODO record successor orderings?
    record images used
    better data saving strategy (ask fred)
    */

    function generateRandomStateOrder(graph) {
      // generates a state ordering without adjacent states occuring after one another
      while (true) {
        let state_order = jsPsych.randomization.repeat(graph.states, 1);
        let adj_states = false;
        for (const ii of _.range(0, state_order.length - 1)) {
          let curr = state_order[ii];
          let next = state_order[ii + 1];
          if (_.includes(graph.graph[curr], next)) {
            adj_states = true;
            break
          }
        }
        if (!adj_states) {
          return state_order
        }
      }
    }

    function generateAllStateTrainingBlocks(el, graph, graphics, nDistractors) {
      let allsuccess = true;
      let state_order = generateRandomStateOrder(graph);

      let training = Promise.resolve();
      state_order.forEach(state => {
            training = training.then(() => {
              return showState(el, graph, graphics, state, nDistractors)
                  .then(function (response_data) {
                        allsuccess = allsuccess && response_data.success && !response_data.peeked;
                        console.log("trained: " + allsuccess);
                        data.responses.push(response_data);
                      }
                  )
            });
          }
      );

      training = training.then(() => {
        if (!allsuccess) {
          console.log('not trained yet');
          return trainingStates(el, graph, graphics, nDistractors, trainingParams)
        }
      });

      return training
    }

    function trainingStates(el, graph, graphics, trainingParams) {
        let training;
        if (trainingParams.strategy === 'allstates') {
          training = generateAllStateTrainingBlocks(el, graph, graphics, trainingParams.nDistractors);
        }
        return training.then(() => {
          console.log(`successfully trained on ${trainingParams.nDistractors} distractors`);
          display_element.innerHTML = ''; // HACK???
          jsPsych.finishTrial(data);
        })
    }
    return trainingStates(display_element, trial.graph, trial.graphics, trial.trainingParams);
  });

  return plugin;
})();
