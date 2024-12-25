const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://historicgems-e6d80.web.app",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser()); // CookieParser use for to get token from the cookie store.

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b6ov8m0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Verify Token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: "unauthorized access" });
  if (token) {
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) {
        // console.log(err);
        return res.status(401).send({ message: "unauthorized access" });
      }
      // console.log(decoded);

      req.user = decoded;
      next();
    });
  }
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // Create a new database
    const artifactsCollection = client
      .db("historic-gems")
      .collection("all-artifacts");
    const likedArtifactsCollection = client
      .db("historic-gems")
      .collection("liked-artifacts");

    // JWT Generate
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Clear token on logout
    app.post("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          maxAge: 0,
        })
        .send({ success: true });
    });

    // ALL POST requests
    // Create new artifact data
    app.post("/create-artifact", verifyToken, async (req, res) => {
      const newArtifacts = req?.body;
      // console.log(newArtifacts);
      const result = await artifactsCollection.insertOne(newArtifacts);
      res.send(result);
      // res.send({ status: true });
    });

    // Create new liked artifacts
    app.post("/liked-artifact/:email", verifyToken, async (req, res) => {
      const email = req?.params?.email;
      const likedData = req?.body;
      const { likedStatus } = likedData;

      let result;
      if (likedStatus === "increase") {
        result = await likedArtifactsCollection.insertOne(likedData);
        const updateDoc = {
          $inc: { liked_count: 1 },
        };
        const filter = {
          _id: new ObjectId(likedData.id),
        };
        const options = {
          upsert: true,
        };
        await artifactsCollection.updateOne(filter, updateDoc, options);
      } else {
        result = await likedArtifactsCollection.deleteOne({
          id: likedData.id,
          liked_by: likedData.liked_by,
        });

        const updateDoc = {
          $inc: { liked_count: -1 },
        };
        const filter = {
          _id: new ObjectId(likedData.id),
        };
        const options = {
          upsert: true,
        };
        await artifactsCollection.updateOne(filter, updateDoc, options);
      }

      res.send(result);
    });

    // ALL GET requests
    app.get("/all-artifacts", async (req, res) => {
      const searchQuery = req?.query?.search;
      let query = {};
      if (searchQuery) {
        query.artifact_name = { $regex: searchQuery, $options: "i" };
      }

      const result = await artifactsCollection.find(query).toArray();
      res.send(result);
    });

    // Top Artifacts
    app.get("/top-artifacts", async (req, res) => {
      const result = await artifactsCollection
        .find()
        .sort({ liked_count: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // Get Single Artifact details
    app.get("/single-artifact/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;
      // console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await artifactsCollection.findOne(query);
      res.send(result);
    });

    // Get Specific users all added artifacts
    app.get("/my-artifacts/:email", verifyToken, async (req, res) => {
      const email = req?.params?.email;
      const tokenEmail = req?.user?.email;

      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      // console.log(email);
      const query = { author_email: email };
      const result = await artifactsCollection.find(query).toArray();
      res.send(result);
    });

    // Liked artifacts
    app.get("/liked-artifacts/:email", verifyToken, async (req, res) => {
      const email = req?.params?.email;
      const tokenEmail = req?.user?.email;

      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const filter = { liked_by: email };
      const result = await likedArtifactsCollection.find(filter).toArray();
      res.send(result);
    });

    // Check Liked
    app.get("/check-liked", verifyToken, async (req, res) => {
      const id = req?.query?.id;
      const email = req?.query?.email;
      // console.log("Email: ", email);
      // console.log("id: ", id);
      const query = {
        id: id,
        liked_by: email,
      };
      const alreadyLiked = await likedArtifactsCollection.findOne(query);

      if (alreadyLiked) {
        // console.log("already liked");
        return res.send({ likedStatus: true });
      }
      // console.log("does not liked");
      res.send({ likedStatus: false });
    });

    // ALL PATCH requests
    app.put("/single-artifact/:id", verifyToken, async (req, res) => {
      const id = req?.params?.id;

      const email = req?.query?.email;
      const tokenEmail = req?.user?.email;
      // console.log("User Email: ", email);
      // console.log("Token Email: ", tokenEmail);

      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const newUpdateData = req?.body;
      // console.log(id, newUpdateData);
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...newUpdateData,
        },
      };

      const result = await artifactsCollection.updateOne(
        filter,
        updateDoc,
        options
      );

      res.send(result);
    });

    // ALL Delete Request

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to the Historics Gems Server site!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
