// Imports
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';
import { Character, User } from './interfaces';

// Session Interface Extension
declare module 'express-session' {
    export interface SessionData {
        user: {
            _id: string;
            username: string;
            role: 'ADMIN' | 'USER';
        }
    }
}

// App Configuration
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'geheim_fallback_voor_dev',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        maxAge: 1000 * 60 * 60 * 24 
    } 
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user;
    next();
});

// Database Configuration
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "cod_dashboard";
const CHAR_COLLECTION = "characters";
const USER_COLLECTION = "users";
const GITHUB_URL = "https://raw.githubusercontent.com/MounirAbdellaoui/Cod_Characters/refs/heads/main/characters/characters.json";

const client = new MongoClient(MONGO_URI);

// Database Connection & Seeding
async function connectAndSeedDatabase() {
    try {
        await client.connect();
        console.log("Verbonden met MongoDB");

        const db = client.db(DB_NAME);
        const usersCol = db.collection<User>(USER_COLLECTION);
        const charsCol = db.collection<Character>(CHAR_COLLECTION);

        const adminExists = await usersCol.findOne({ username: 'admin' });
        if (!adminExists) {
            const hash = await bcrypt.hash('admin123', 10);
            await usersCol.insertOne({ username: 'admin', password: hash, role: 'ADMIN' });
            console.log("Admin user aangemaakt (pass: admin123)");
        }

        const userExists = await usersCol.findOne({ username: 'user' });
        if (!userExists) {
            const hash = await bcrypt.hash('user123', 10);
            await usersCol.insertOne({ username: 'user', password: hash, role: 'USER' });
            console.log("Standaard user aangemaakt (pass: user123)");
        }

        const count = await charsCol.countDocuments();
        if (count === 0) {
            console.log("Characters database leeg. Ophalen van GitHub...");
            const response = await fetch(GITHUB_URL);
            const data = await response.json() as Character[];
            await charsCol.insertMany(data);
            console.log(`${data.length} characters geïmporteerd.`);
        }

    } catch (error) {
        console.error("Fout bij database setup:", error);
    }
}

connectAndSeedDatabase();

function getDb() {
    return client.db(DB_NAME);
}

// Security Middleware
const requireLogin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.session.user && req.session.user.role === 'ADMIN') {
        next();
    } else {
        res.status(403).render('error', { message: "Geen toegang. Alleen voor admins." });
    }
};

// Authentication Routes
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/characters');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await getDb().collection<User>(USER_COLLECTION).findOne({ username });

    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = {
            _id: user._id?.toString()!,
            username: user.username,
            role: user.role
        };
        res.redirect('/characters');
    } else {
        res.render('login', { error: "Gebruikersnaam of wachtwoord onjuist." });
    }
});

app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/characters');
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const usersCol = getDb().collection<User>(USER_COLLECTION);

    const existing = await usersCol.findOne({ username });
    if (existing) {
        return res.render('register', { error: "Gebruikersnaam bestaat al." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    await usersCol.insertOne({
        username,
        password: hashedPassword,
        role: 'USER'
    });

    res.redirect('/login');
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// Application Routes
app.get('/', (req, res) => {
    res.redirect('/characters');
});

app.get('/characters', requireLogin, async (req, res) => {
    try {
        const collection = getDb().collection<Character>(CHAR_COLLECTION);
        let characters = await collection.find({}).toArray();

        const search = req.query.search as string || "";
        if (search) {
            characters = characters.filter(c => 
                c.name.toLowerCase().includes(search.toLowerCase())
            );
        }

        const sortField = req.query.sort as keyof Character || 'name';
        const sortOrder = req.query.order === 'desc' ? -1 : 1;
        
        characters.sort((a, b) => {
            let valA = a[sortField];
            let valB = b[sortField];

            if (sortField === 'unit') {
                valA = a.unit.name;
                valB = b.unit.name;
            }

            if (valA < valB) return -1 * sortOrder;
            if (valA > valB) return 1 * sortOrder;
            return 0;
        });

        res.render('index', { characters, search, sortField, sortOrder });
    } catch (error) {
        console.error(error);
        res.status(500).send("Database fout");
    }
});

app.get('/characters/:id', requireLogin, async (req, res) => {
    try {
        const char = await getDb().collection<Character>(CHAR_COLLECTION).findOne({ id: req.params.id });
        if (!char) return res.status(404).send("Niet gevonden");
        res.render('detail', { character: char });
    } catch (e) { res.status(500).send("Error"); }
});

app.get('/characters/:id/edit', requireLogin, requireAdmin, async (req, res) => {
    try {
        const char = await getDb().collection<Character>(CHAR_COLLECTION).findOne({ id: req.params.id });
        if (!char) return res.status(404).send("Niet gevonden");
        res.render('edit', { character: char });
    } catch (e) { res.status(500).send("Error"); }
});

app.post('/characters/:id/edit', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { name, age, description, isActive } = req.body;
        
        await getDb().collection<Character>(CHAR_COLLECTION).updateOne(
            { id: req.params.id },
            { $set: {
                name,
                age: parseInt(age),
                description,
                isActive: isActive === "true"
            }}
        );
        res.redirect(`/characters/${req.params.id}`);
    } catch (e) { res.status(500).send("Error bij updaten"); }
});

app.get('/units', requireLogin, async (req, res) => {
    try {
        const characters = await getDb().collection<Character>(CHAR_COLLECTION).find({}).toArray();
        const uniqueUnits = Array.from(new Map(characters.map(c => [c.unit.id, c.unit])).values());
        res.render('units', { units: uniqueUnits });
    } catch (e) { res.status(500).send("Error"); }
});

app.get('/units/:id', requireLogin, async (req, res) => {
    try {
        const unitId = req.params.id;
        
        const members = await getDb().collection<Character>(CHAR_COLLECTION)
            .find({ "unit.id": unitId })
            .toArray();

        const unitInfo = await getDb().collection('emblems').findOne({ id: unitId });

        const finalUnitData = unitInfo || (members.length > 0 ? members[0].unit : null);

        if (!finalUnitData) {
            return res.status(404).send(`Unit ${unitId} niet gevonden.`);
        }

        res.render('unit-detail', { unit: finalUnitData, members: members });
    } catch (e) { 
        console.error(e);
        res.status(500).send("Error bij ophalen unit"); 
    }
});

app.get('/users', requireLogin, requireAdmin, async (req, res) => {
    try {
        const users = await getDb().collection<User>(USER_COLLECTION).find({}).toArray();
        res.render('users', { users: users });
    } catch (e) {
        console.error(e);
        res.status(500).send("Error bij ophalen gebruikers");
    }
});

// Server Start
app.listen(PORT, () => console.log(`Server draait op http://localhost:${PORT}`));