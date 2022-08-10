if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const app = express();
const ejs = require("ejs");
const mongoose = require("mongoose");
const path = require("path");
const Todo = require("./models/todo");
const engine = require("ejs-mate");
const methodOverride = require("method-override");
const { findByIdAndUpdate } = require("./models/todo");
const DoneTodo = require("./models/doneTodos");
const { text } = require("express");
const dayjs = require("dayjs");
const moment = require("moment");
const AppError = require("./AppError");
const Joi = require("joi");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user");
const mongoSanitize = require("express-mongo-sanitize");
const helmet = require("helmet");
const MongoStore = require("connect-mongo");

app.use(express.urlencoded({ extended: false }));
app.engine("ejs", engine);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));
app.use(methodOverride("_method"));
app.use(mongoSanitize());

const secret = process.env.SECRET || "thisshouldbeasecret";
const db_url = process.env.DB_URL || "mongodb://localhost:27017/todoList";

const store = MongoStore.create({
  mongoUrl: db_url,
  secret,
  touchAfter: 24 * 3600,
});

store.on("error", function (e) {
  console.log("SESSION STORE ERROR", e);
});

const sessionConfig = {
  store,
  secret,
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
};

app.use(session(sessionConfig));
app.use(flash());
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

mongoose
  .connect(db_url)
  .then((res) => {
    console.log("DATABASE CONNECTED");
  })
  .catch((e) => {
    console.log("CANNOT CONNECT TO DATABASE", e);
  });

app.use(express.static(path.join(__dirname, "public")));

function wrapAsync(fn) {
  return function (req, res, next) {
    fn(req, res, next).catch((e) => next(e));
  };
}
const validateTodo = (req, res, next) => {
  const todoSchema = Joi.object({
    todo: Joi.string().required(),
    date: Joi.date().required(),
  });
  const { error } = todoSchema.validate(req.body);
  if (error) {
    const msg = error.details.map((el) => el.message).join(",");
    throw new AppError(msg, 400);
  } else {
    next();
  }
};

const isLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    req.flash("success", "You must be signed in first!");
    return res.redirect("/login");
  }
  next();
};

app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.success = req.flash("success");
  next();
});

app.get("/", (req, res) => {
  res.redirect("/todo");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post(
  "/register",
  wrapAsync(async (req, res) => {
    try {
      const { email, username, password } = req.body;
      const user = new User({ email, username });
      const registeredUser = await User.register(user, password);
      req.login(registeredUser, (err) => {
        if (err) return next(err);
        req.flash("Welcome to Yelp Camp!");
        res.redirect("/todo");
      });
    } catch (e) {
      req.flash("success", e.message);
      res.redirect("/register");
    }
  })
);

app.get("/login", (req, res) => {
  res.render("login");
});

app.post(
  "/login",
  passport.authenticate("local", {
    failureFlash: true,
    failureRedirect: "/login",
  }),
  (req, res) => {
    res.redirect("/todo");
  }
);

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    req.flash("success", "Goodbye!");
    res.redirect("/login");
  });
});

app.get(
  "/todo",
  isLoggedIn,
  wrapAsync(async (req, res, next) => {
    const { date = moment().format("YYYY-MM-DD") } = req.query;
    console.log(date);
    const queryDate = moment(date);
    const today = moment().startOf("day");
    if (date) {
      const allTodos = await Todo.find({
        added: {
          $gte: queryDate.toDate(),
          $lte: moment(queryDate).endOf("day").toDate(),
        },
        author: req.user._id,
      });
      const allDoneTodos = await DoneTodo.find({
        added: {
          $gte: queryDate.toDate(),
          $lte: moment(queryDate).endOf("day").toDate(),
        },
        author: req.user._id,
      });
      res.render("home", { allTodos, allDoneTodos, date });
    } else {
      const allTodos = await Todo.find({
        added: {
          $gte: today.toDate(),
          $lte: moment(today).endOf("day").toDate(),
        },
        author: req.user._id,
      });
      const allDoneTodos = await DoneTodo.find({
        added: {
          $gte: today.toDate(),
          $lte: moment(today).endOf("day").toDate(),
        },
        author: req.user._id,
      });

      res.render("home", { allTodos, allDoneTodos, date });
    }
  })
);

app.post(
  "/todo",
  isLoggedIn,
  validateTodo,
  wrapAsync(async (req, res, next) => {
    const { todo, date } = req.body;
    const newTodo = new Todo({ text: todo, added: date, author: req.user });
    await newTodo.save();
    res.redirect(`/todo?date=${date}`);
  })
);

app.get(
  "/todo/:id/edit",
  isLoggedIn,
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    const todo = await Todo.findById(id);
    res.render("edit", { todo });
  })
);

app.put(
  "/todo/:id",
  isLoggedIn,
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    const newText = req.body.todo;
    // console.log(newText)
    const updatedTodo = await Todo.findByIdAndUpdate(
      id,
      { text: newText },
      { runValidators: true }
    );
    res.redirect("/todo");
  })
);

app.delete(
  "/todo/:id",
  isLoggedIn,
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    const deletedTodo =
      (await Todo.findByIdAndDelete(id, { new: true })) ||
      (await DoneTodo.findByIdAndDelete(id, { new: true }));
    const date = moment(deletedTodo.added).format("YYYY-MM-DD");
    res.redirect(`/todo?date=${date}`);
  })
);

app.delete(
  "/todo/:id/done",
  isLoggedIn,
  wrapAsync(async (req, res, next) => {
    const { id } = req.params;
    const deletedTodo = await Todo.findByIdAndDelete(id, { new: true });
    const newDoneTodo = new DoneTodo({
      text: deletedTodo.text,
      added: deletedTodo.added,
      author: deletedTodo.author,
    });
    await newDoneTodo.save();
    const date = moment(deletedTodo.added).format("YYYY-MM-DD");
    res.redirect(`/todo?date=${date}`);
  })
);

app.all("*", (req, res) => {
  res.status(404).send("NOT FOUND!");
});

app.use((err, req, res, next) => {
  const { status = 500 } = err;
  if (!err.message) err.message = "Something went wrong";
  res.status(status).render("error", { err });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`LISTENING ON PORT ${port}`);
});
