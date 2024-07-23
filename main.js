const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

Array.prototype.chunks = function(chunkSize) {
  const a = [];

  for (let i = 0; i < this.length; i += chunkSize) {
      const chunk = this.slice(i, i + chunkSize);
      a.push(chunk);
  }

  return a;
};

let variable_counter = 0;
const generate_variable_name = () => {
  variable_counter += 1;
  return `a${variable_counter - 1}`;
}

class Position {
  x = 0;
  y = 0;
}

class Circle {
  position = new Position();
  radius = 0;
  }

class Ellipse {
  position = new Position();
  radius_x = 0;
  radius_y = 0;
}

const Command = {
  NotSet: "NotSet",
  MoveAbsolute: "MoveAbsolute",
  MoveRelative: "MoveRelative",
  LineAbsolute: "LineAbsolute",
  LineRelative: "LineRelative",
  HorizontalLineAbsolute: "HorizontalLineAbsolute",
  HorizontalLineRelative: "HorizontalLineRelative",
  VerticalLineAbsolute: "VerticalLineAbsolute",
  VerticalLineRelative: "VerticalLineRelative",
  QuadraticBezierAbsolute: "QuadraticBezierAbsolute",
  QuadraticBezierRelative: "QuadraticBezierRelative",
  QuadraticBezierSmoothAbsolute: "QuadraticBezierSmoothAbsolute",
  QuadraticBezierSmoothRelative: "QuadraticBezierSmoothRelative",
  CubicBezierAbsolute: "CubicBezierAbsolute",
  CubicBezierRelative: "CubicBezierRelative",
  CubicBezierSmoothAbsolute: "CubicBezierSmoothAbsolute",
  CubicBezierSmoothRelative: "CubicBezierSmoothRelative",
  EllipticalArcAbsolute: "EllipticalArcAbsolute",
  EllipticalArcRelative: "EllipticalArcRelative",
  StopAbsolute: "StopAbsolute",
  StopRelative: "StopRelative",
}

class PathState {
  command = Command.NotSet;
  values = [];
  value_buffer = "";
  is_path_open = false;

  // Handles the case of whitespace preceding a command, because detecting a new
  // command will also cause the value to be pushed to the values stack.
  is_value_already_pushed = false;

  // See the terminology at https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#moveto_path_commands
  current_point = new Position();

  constructor(offsetCoords) {
    this.offsetCoords = offsetCoords ?? { x: 0, y: 0 };
  }

  push_value() {
    // Don't push anything if there is nothing buffered.
    if (this.value_buffer.length == 0) {
      return;
    }

    let value = parseFloat(this.value_buffer);
    this.values.push(value);
    this.value_buffer = "";
  }

  push_command(command) {
    if (this.value_buffer != "") {
      this.push_value();
      this.is_value_already_pushed = true;
    }

    this.handle_command();

    let current_point = this.current_point;
    this.values = [];
    this.value_buffer = "";
    this.is_value_already_pushed = false;
    this.command = command;
    this.current_point = current_point;
  }

  handle_command() {
    // Do things based on the command
    // console.log(this)
    switch (this.command) {
      case Command.NotSet: { break; /* Do nothing when the command is not set. */ }
      case Command.MoveAbsolute: {
        for (let args of this.values.chunks(2)) {
          this.current_point.x = args[0];
          this.current_point.y = args[1];
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y

          // We don't have this in KCL so treat it as a new sketch
          if (this.is_path_open) { console.log(`|> close(%)\n`); }
          console.log(`let ${generate_variable_name()} = startSketchAt([${x}, ${y}])`);
          this.is_path_open = true;
        }
        break;
      }
      case Command.MoveRelative: {
        for (let args of this.values.chunks(2)) {
          this.current_point.x += args[0];
          this.current_point.y += args[1];
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y
          
          // We don't have this in KCL so treat it as a new sketch
          if (this.is_path_open) { console.log(`|> close(%)\n`); }
          console.log(`let ${generate_variable_name()} = startSketchAt([${x}, ${y}])`);
          this.is_path_open = true;
        }
        break;
      }
      case Command.LineAbsolute: {
        for (let args of this.values.chunks(2)) {
          this.current_point.x = args[0];
          this.current_point.y = args[1];
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y
          
          console.log(`|> lineTo([${x}, ${y}], %)`);
        }
        break;
      }
      case Command.LineRelative: {
        for (let args of this.values.chunks(2)) {
          this.current_point.x += args[0];
          this.current_point.y += args[1];
          
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y
          
          console.log(`|> line([${x}, ${y}], %)`);
        }
        break;
      }
      case Command.HorizontalLineAbsolute: {
        for (let args of this.values.chunks(2)) {
          this.current_point.x = args[0];
         
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y
          
          console.log(`|> line([${x}, ${y}], %)`);
        }
        break;
      }
      case Command.HorizontalLineRelative: {
        for (let args of this.values.chunks(2)) {
          this.current_point.x += args[0];
          
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y
          
          console.log(`|> line([${x}, ${y}], %)`);
        }
        break;
      }
      case Command.VerticalLineAbsolute: {
        for (let args of this.values.chunks(2)) {
          this.current_point.y = args[0];
          
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y
          
          console.log(`|> line([${x}, ${y}], %)`);
        }
        break;
      }
      case Command.VerticalLineRelative: {
        for (let args of this.values.chunks(2)) {
          this.current_point.y += args[0];
          
          const x = this.current_point.x + this.offsetCoords.x;
          const y = -this.current_point.y + this.offsetCoords.y
          
          console.log(`|> line([${x}, ${y}], %)`);
        }
        break;
      }
      case Command.QuadraticBezierAbsolute: {
        for (let args of this.values.chunks(4)) {
          console.log(`|> bezierCurve({
              control1: [
                ${args[0] + this.offsetCoords.x}, ${-args[1] + this.offsetCoords.y}
              ],
              control2: [
                ${args[0] + this.offsetCoords.x}, ${-args[1] + this.offsetCoords.y}
              ],
              to: [
                ${args[2] + this.offsetCoords.x}, ${-args[3] + this.offsetCoords.y}
              ]
         }, %)`);

          this.current_point.x = args[2];
          this.current_point.y = args[3];
        }
        break;
      }
      case Command.QuadraticBezierRelative: {
        for (let args of this.values.chunks(4)) {
          if (args.length != 4) {
            // Should never happen but does because of how other software exports SVGs.
            break;
          }
          
          console.log(`|> bezierCurve({
              control1: [
                ${this.current_point.x + args[0] + this.offsetCoords.x}, ${-(this.current_point.y + args[1]) + this.offsetCoords.y}
                ],
              control2: [
                ${this.current_point.x + args[0] + this.offsetCoords.x}, ${-(this.current_point.y + args[1]) + this.offsetCoords.y}
                ],
              to: [
                ${this.current_point.x + args[2] + this.offsetCoords.x}, ${-(this.current_point.y + args[3]) + this.offsetCoords.y}
              ]
         }, %)`);

          this.current_point.x += args[2];
          this.current_point.y += args[3];
        }
        break;
      }
      case Command.QuadraticBezierSmoothAbsolute: { break; }
      case Command.QuadraticBezierSmoothRelative: { break; }
      case Command.CubicBezierAbsolute: {
        for (let args of this.values.chunks(6)) {
          console.log(`|> bezierCurve({
    control1: [ ${args[0] - this.current_point.x  + this.offsetCoords.x}, ${-args[1] + this.current_point.y + this.offsetCoords.y} ],
    control2: [ ${args[2] - this.current_point.x + this.offsetCoords.x}, ${-args[3] + this.current_point.y + this.offsetCoords.y} ],
    to: [ ${args[4] - this.current_point.x + this.offsetCoords.x}, ${-args[5] + this.current_point.y + this.offsetCoords.y} ]
}, %)`);

          this.current_point.x = args[4];
          this.current_point.y = args[5];
        }
        break;
      }
      case Command.CubicBezierRelative: {
        for (let args of this.values.chunks(6)) {
          if (args.length != 6) {
            // Should never happen but does because of how other software exports SVGs.
            break;
          }
          
          console.log(`|> bezierCurve({
  control1: [ ${args[0] + this.offsetCoords.x}, ${-(args[1]) + this.offsetCoords.y} ],
  control2: [ ${args[2] + this.offsetCoords.x}, ${-(args[3]) + this.offsetCoords.y} ],
  to: [ ${args[4] + this.offsetCoords.x}, ${-(args[5]) + this.offsetCoords.y} ]
 }, %)`);

          this.current_point.x += args[4];
          this.current_point.y += args[5];
        }
        break;
      }
      case Command.CubicBezierSmoothAbsolute: { break; }
      case Command.CubicBezierSmoothRelative: { break; }
      case Command.EllipticalArcAbsolute: { break; }
      case Command.EllipticalArcRelative: { break; }
      case Command.StopAbsolute: {
        break;
      }
      case Command.StopRelative: {
        break;
      }
    }
  }
}

const svg2kcl = (svgAsText) => {
  const svg = (new JSDOM(svgAsText)).window.document.querySelector("svg");

  let translate = { x: 0, y: 0, };

  let escape = false;

  const startPathAndTrackSomeThings = (e, translate) => {
    const fillValue = e.style.fill || e.attributes.fill?.value;

    // Used to center the object when being created
    const offsetCoords = {
      x: (parseFloat(svg.width?.baseVal.valueInSpecifiedUnits ?? 0) / -2) + translate.x,
      y: (parseFloat(svg.height?.baseVal.valueInSpecifiedUnits ?? 0) / 2) - translate.y,
    };

    return offsetCoords;
  };

  const closePathAndCleanUp = () => {
    console.log(`|> close(%)\n`);
    this.is_path_open = false;
  };

  const traverse = (root) => {
    for (let e of root.children) {
      switch (e.tagName) {
        case "g": {
          if (e.transform?.baseVal.length === 0) break;

          translate = {
            x: translate.x + (e.transform?.baseVal[0].matrix.e ?? 0),
            y: translate.y + (e.transform?.baseVal[0].matrix.f ?? 0),
          };
          break;
        }
        case "path": {
          for (let attr of e.attributes) {
            switch (attr.name) {
              case "d": {
                const offsetCoords = startPathAndTrackSomeThings(e, translate);

                let state = new PathState(offsetCoords);

                // To handle the initial Command.NotSet, which has no values.
                state.is_value_already_pushed = true;
                
                for (let char of attr.value.split("")) {
                  switch (char) {
                    case 'M': state.push_command(Command.MoveAbsolute); break;
                    case 'm': state.push_command(Command.MoveRelative); break;
                    case 'L': state.push_command(Command.LineAbsolute); break;
                    case 'l': state.push_command(Command.LineRelative); break;
                    case 'H': state.push_command(Command.HorizontalLineAbsolute); break;
                    case 'h': state.push_command(Command.HorizontalLineRelative); break;
                    case 'V': state.push_command(Command.VerticalLineAbsolute); break;
                    case 'v': state.push_command(Command.VerticalLineRelative); break;
                    case 'C': state.push_command(Command.CubicBezierAbsolute); break;
                    case 'c': state.push_command(Command.CubicBezierRelative); break;
                    case 'S': state.push_command(Command.CubicBezierSmoothAbsolute); break;
                    case 's': state.push_command(Command.CubicBezierSmoothRelative); break;
                    case 'Q': state.push_command(Command.QuadraticBezierAbsolute); break;
                    case 'q': state.push_command(Command.QuadraticBezierRelative); break;
                    case 'T': state.push_command(Command.QuadraticBezierSmoothAbsolute); break;
                    case 't': state.push_command(Command.QuadraticBezierSmoothRelative); break;
                    case 'A': state.push_command(Command.EllipticalArcAbsolute); break;
                    case 'a': state.push_command(Command.EllipticalArcRelative); break;
                    case 'Z': state.push_command(Command.StopAbsolute); break;
                    case 'z': state.push_command(Command.StopRelative); break;
                    case ',': {
                      state.push_value();
                      break;
                    }
                    case '-': {
                      state.push_value();
                      state.value_buffer += char;
                      break;
                    }
                    case ' ': {
                      state.push_value();
                      state.is_value_already_pushed = true;
                      break;
                    }

                    // Yep, thanks JS, for no multi-case on one line.
                    case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
                    case '.': {
                      state.value_buffer += char;
                      break;
                    }
                  }

                  switch (state.command) {
                    case Command.StopAbsolute:
                    case Command.StopRelative: {
                      state.push_value();
                      state.handle_command();
                      break;
                    }
                  }
                } // for

                // It's possible we stopped without processing the last command
                // because some programs generate without Z or z command.
                // We know this if there is still data in the value buffer.
                // Pushing a fake Z or z command will resolve the issue.
                if (state.value_buffer.length > 0) {
                  state.push_value();
                  state.push_command(Command.StopAbsolute);
                }

                closePathAndCleanUp();
                break;
              }
            }

            if (escape) break;
          }
        }
      }

      if (escape) break;

      traverse(e);
    }
  };

  traverse(svg);
}

svg2kcl(fs.readFileSync(path.join(process.argv[2]), 'utf-8'));
